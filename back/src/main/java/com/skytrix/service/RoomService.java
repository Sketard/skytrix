package com.skytrix.service;

import java.security.SecureRandom;
import java.util.List;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.mapper.RoomMapper;
import com.skytrix.model.dto.room.CreateRoomDTO;
import com.skytrix.model.dto.room.DuelDeckDTO;
import com.skytrix.model.dto.room.JoinRoomDTO;
import com.skytrix.model.dto.room.RoomDTO;
import com.skytrix.model.entity.CardDeckIndex;
import com.skytrix.model.entity.Room;
import com.skytrix.model.enums.DeckKeyword;
import com.skytrix.model.enums.RoomStatus;
import com.skytrix.repository.CardDeckIndexRepository;
import com.skytrix.repository.DeckRepository;
import com.skytrix.repository.RoomRepository;
import com.skytrix.security.AuthService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class RoomService {

    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 6;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RoomRepository roomRepository;
    private final DeckRepository deckRepository;
    private final CardDeckIndexRepository cardDeckIndexRepository;
    private final AuthService authService;
    private final DuelServerClient duelServerClient;
    private final RoomMapper roomMapper;

    @Transactional
    public RoomDTO createRoom(CreateRoomDTO dto) {
        var user = authService.getConnectedUser();
        validateDeck(dto.getDecklistId(), user.getId());

        var room = new Room();
        room.setRoomCode(generateUniqueRoomCode());
        room.setPlayer1(user);
        room.setPlayer1DecklistId(dto.getDecklistId());
        room.setStatus(RoomStatus.WAITING);

        roomRepository.save(room);
        return roomMapper.toRoomDTO(room, user.getId());
    }

    // TODO [H3 review]: pessimistic lock held during duelServerClient.createDuel() external HTTP call.
    // Post-MVP: split into claim (short tx) -> external call -> activate/rollback (short tx)
    // to avoid holding DB connection/lock during external IO.
    @Transactional
    public RoomDTO joinRoom(String roomCode, JoinRoomDTO dto) {
        var user = authService.getConnectedUser();
        var room = roomRepository.findByRoomCodeForUpdate(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));

        if (room.getStatus() != RoomStatus.WAITING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Room is full");
        }
        if (room.getPlayer1().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot join your own room");
        }

        var deckCards = validateDeck(dto.getDecklistId(), user.getId());

        room.setPlayer2(user);
        room.setPlayer2DecklistId(dto.getDecklistId());
        room.setStatus(RoomStatus.CREATING_DUEL);
        roomRepository.save(room);

        try {
            var deck1Cards = cardDeckIndexRepository.findByDeckId(room.getPlayer1DecklistId());
            var deck1 = extractDeck(deck1Cards);
            var deck2 = extractDeck(deckCards);
            var response = duelServerClient.createDuel(
                    room.getPlayer1().getId().toString(),
                    deck1,
                    user.getId().toString(),
                    deck2
            );

            if (response == null || response.getWsTokens() == null || response.getWsTokens().length < 2) {
                throw new RestClientException("Invalid duel server response");
            }

            if (response.getDuelId() == null) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Duel server returned no duel ID");
            }

            room.setDuelServerId(response.getDuelId());
            room.setWsToken1(response.getWsTokens()[0]);
            room.setWsToken2(response.getWsTokens()[1]);
            room.setStatus(RoomStatus.ACTIVE);
            roomRepository.save(room);

            return roomMapper.toRoomDTO(room, user.getId());
        } catch (RestClientException e) {
            room.setStatus(RoomStatus.WAITING);
            room.setPlayer2(null);
            room.setPlayer2DecklistId(null);
            roomRepository.save(room);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Duel server unavailable", e);
        }
    }

    @Transactional(readOnly = true)
    public RoomDTO getRoom(String roomCode, Long requestingUserId) {
        var room = roomRepository.findByRoomCode(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        return roomMapper.toRoomDTO(room, requestingUserId);
    }

    @Transactional(readOnly = true)
    public List<RoomDTO> listOpenRooms() {
        var userId = authService.getConnectedUserId();
        return roomRepository.findTop10ByStatusWithPlayers(RoomStatus.WAITING, PageRequest.of(0, 10)).stream()
                .map(room -> roomMapper.toRoomDTO(room, userId))
                .toList();
    }

    @Transactional
    public void endRoom(String roomCode) {
        var userId = authService.getConnectedUserId();
        var room = roomRepository.findByRoomCode(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        if (!userId.equals(room.getPlayer1().getId())
                && (room.getPlayer2() == null || !userId.equals(room.getPlayer2().getId()))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not a participant of this room");
        }
        if (room.getStatus() == RoomStatus.ENDED || room.getStatus() == RoomStatus.CLOSED) {
            return;
        }
        if (room.getDuelServerId() != null) {
            duelServerClient.terminateDuel(room.getDuelServerId());
        }
        room.setStatus(RoomStatus.ENDED);
        roomRepository.save(room);
    }

    /**
     * Validates that the deck exists, belongs to the user, and meets size constraints.
     * Returns the list of CardDeckIndex for reuse (avoids double DB query).
     */
    private List<CardDeckIndex> validateDeck(Long decklistId, Long userId) {
        var deck = deckRepository.findById(decklistId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Deck not found"));
        if (!deck.getUser().getId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Deck does not belong to user");
        }

        var deckCards = cardDeckIndexRepository.findByDeckId(decklistId);
        long mainCount = deckCards.stream().filter(c -> c.getType() == DeckKeyword.MAIN).count();
        long extraCount = deckCards.stream().filter(c -> c.getType() == DeckKeyword.EXTRA).count();
        long sideCount = deckCards.stream().filter(c -> c.getType() == DeckKeyword.SIDE).count();

        if (mainCount < DeckKeyword.MAIN.getMinSize() || mainCount > DeckKeyword.MAIN.getMaxSize()) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Main Deck must have " + DeckKeyword.MAIN.getMinSize() + "-" + DeckKeyword.MAIN.getMaxSize()
                            + " cards (has " + mainCount + ")");
        }
        if (extraCount > DeckKeyword.EXTRA.getMaxSize()) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Extra Deck must have " + DeckKeyword.EXTRA.getMinSize() + "-" + DeckKeyword.EXTRA.getMaxSize()
                            + " cards (has " + extraCount + ")");
        }
        if (sideCount > DeckKeyword.SIDE.getMaxSize()) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Side Deck must have " + DeckKeyword.SIDE.getMinSize() + "-" + DeckKeyword.SIDE.getMaxSize()
                            + " cards (has " + sideCount + ")");
        }

        return deckCards;
    }

    private DuelDeckDTO extractDeck(List<CardDeckIndex> cards) {
        // Yu-Gi-Oh passcodes fit in int range (max ~100M), so intValue() is safe
        var main = cards.stream()
                .filter(c -> c.getType() == DeckKeyword.MAIN)
                .mapToInt(c -> c.getCard().getPasscode().intValue())
                .toArray();
        var extra = cards.stream()
                .filter(c -> c.getType() == DeckKeyword.EXTRA)
                .mapToInt(c -> c.getCard().getPasscode().intValue())
                .toArray();
        return new DuelDeckDTO(main, extra);
    }

    private String generateUniqueRoomCode() {
        for (int attempt = 0; attempt < 3; attempt++) {
            var code = generateRoomCode();
            try {
                if (roomRepository.findByRoomCode(code).isEmpty()) {
                    return code;
                }
            } catch (DataIntegrityViolationException e) {
                // Room code collision on concurrent insert, retry
            }
        }
        throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Could not generate unique room code");
    }

    private String generateRoomCode() {
        var sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(CHARS.charAt(RANDOM.nextInt(CHARS.length())));
        }
        return sb.toString();
    }
}
