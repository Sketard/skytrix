package com.skytrix.service;

import java.security.SecureRandom;
import java.util.List;

import jakarta.inject.Inject;

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
import com.skytrix.model.entity.Room;
import com.skytrix.model.enums.DeckKeyword;
import com.skytrix.model.enums.RoomStatus;
import com.skytrix.repository.CardDeckIndexRepository;
import com.skytrix.repository.DeckRepository;
import com.skytrix.repository.RoomRepository;
import com.skytrix.security.AuthService;

@Service
public class RoomService {

    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 6;
    private static final SecureRandom RANDOM = new SecureRandom();

    @Inject
    private RoomRepository roomRepository;

    @Inject
    private DeckRepository deckRepository;

    @Inject
    private CardDeckIndexRepository cardDeckIndexRepository;

    @Inject
    private AuthService authService;

    @Inject
    private DuelServerClient duelServerClient;

    @Inject
    private RoomMapper roomMapper;

    @Transactional
    public RoomDTO createRoom(CreateRoomDTO dto) {
        var user = authService.getConnectedUser();
        var deck = deckRepository.findById(dto.getDecklistId())
                .orElseThrow(() -> new IllegalArgumentException("Deck not found"));
        if (!deck.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("Deck does not belong to user");
        }

        var room = new Room();
        room.setRoomCode(generateUniqueRoomCode());
        room.setPlayer1(user);
        room.setPlayer1DecklistId(dto.getDecklistId());
        room.setStatus(RoomStatus.WAITING);

        roomRepository.save(room);
        return roomMapper.toRoomDTO(room, user.getId());
    }

    // TODO [H3 review]: pessimistic lock held during duelServerClient.createDuel() external HTTP call.
    // Post-MVP: split into claim (short tx) → external call → activate/rollback (short tx)
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

        var deck = deckRepository.findById(dto.getDecklistId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Deck not found"));
        if (!deck.getUser().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Deck does not belong to user");
        }

        var deckCards = cardDeckIndexRepository.findByDeckId(dto.getDecklistId());
        long mainCount = deckCards.stream().filter(c -> c.getType() == DeckKeyword.MAIN).count();
        long extraCount = deckCards.stream().filter(c -> c.getType() == DeckKeyword.EXTRA).count();
        long sideCount = deckCards.stream().filter(c -> c.getType() == DeckKeyword.SIDE).count();

        if (mainCount < 40 || mainCount > 60) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Main Deck must have 40-60 cards (has " + mainCount + ")");
        }
        if (extraCount > 15) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Extra Deck must have 0-15 cards (has " + extraCount + ")");
        }
        if (sideCount > 15) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Side Deck must have 0-15 cards (has " + sideCount + ")");
        }

        room.setPlayer2(user);
        room.setPlayer2DecklistId(dto.getDecklistId());
        room.setStatus(RoomStatus.CREATING_DUEL);
        roomRepository.save(room);

        try {
            var deck1 = extractDeck(room.getPlayer1DecklistId());
            var deck2 = extractDeck(dto.getDecklistId());
            var response = duelServerClient.createDuel(
                    room.getPlayer1().getId().toString(),
                    deck1,
                    user.getId().toString(),
                    deck2
            );

            if (response == null || response.getTokens() == null || response.getTokens().length < 2) {
                throw new RestClientException("Invalid duel server response");
            }

            room.setDuelServerId(response.getDuelId());
            room.setWsToken1(response.getTokens()[0]);
            room.setWsToken2(response.getTokens()[1]);
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

    public RoomDTO getRoom(String roomCode, Long requestingUserId) {
        var room = roomRepository.findByRoomCode(roomCode)
                .orElseThrow(() -> new IllegalArgumentException("Room not found"));
        return roomMapper.toRoomDTO(room, requestingUserId);
    }

    public List<RoomDTO> listOpenRooms() {
        var userId = authService.getConnectedUserId();
        return roomRepository.findTop10ByStatusOrderByCreatedAtDesc(RoomStatus.WAITING).stream()
                .map(room -> roomMapper.toRoomDTO(room, userId))
                .toList();
    }

    @Transactional
    public void endRoom(Long roomId) {
        var userId = authService.getConnectedUserId();
        var room = roomRepository.findById(roomId)
                .orElseThrow(() -> new IllegalArgumentException("Room not found"));
        if (!userId.equals(room.getPlayer1().getId())
                && (room.getPlayer2() == null || !userId.equals(room.getPlayer2().getId()))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not a participant of this room");
        }
        room.setStatus(RoomStatus.ENDED);
        roomRepository.save(room);
    }

    private DuelDeckDTO extractDeck(Long decklistId) {
        var cards = cardDeckIndexRepository.findByDeckId(decklistId);
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
            if (roomRepository.findByRoomCode(code).isEmpty()) {
                return code;
            }
        }
        throw new RuntimeException("Failed to generate unique room code after 3 attempts");
    }

    private String generateRoomCode() {
        var sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(CHARS.charAt(RANDOM.nextInt(CHARS.length())));
        }
        return sb.toString();
    }
}
