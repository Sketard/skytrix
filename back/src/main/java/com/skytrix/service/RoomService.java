package com.skytrix.service;

import java.security.SecureRandom;
import java.util.List;
import java.util.stream.Collectors;

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
import com.skytrix.model.dto.room.QuickDuelDTO;
import com.skytrix.model.dto.room.QuickDuelResponseDTO;
import com.skytrix.model.dto.room.RoomDTO;
import com.skytrix.model.entity.CardDeckIndex;
import com.skytrix.model.entity.Room;
import com.skytrix.model.enums.DeckKeyword;
import com.skytrix.model.enums.RoomStatus;
import com.skytrix.repository.CardDeckIndexRepository;
import com.skytrix.repository.CardRepository;
import com.skytrix.repository.DeckRepository;
import com.skytrix.repository.RoomRepository;
import com.skytrix.security.AuthService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class RoomService {

    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 6;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RoomRepository roomRepository;
    private final DeckRepository deckRepository;
    private final CardDeckIndexRepository cardDeckIndexRepository;
    private final CardRepository cardRepository;
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
            validatePasscodesOrThrow(deck1, deck1Cards, deck2, deckCards);
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

    @Transactional
    public QuickDuelResponseDTO quickDuel(QuickDuelDTO dto) {
        var user = authService.getConnectedUser();
        var deckCards1 = validateDeck(dto.getDecklistId1(), user.getId());
        var deckCards2 = validateDeck(dto.getDecklistId2(), user.getId());
        var p2First = Integer.valueOf(2).equals(dto.getFirstPlayer());

        var room = new Room();
        room.setRoomCode(generateUniqueRoomCode());
        room.setPlayer1(user);
        room.setPlayer1DecklistId(dto.getDecklistId1());
        room.setPlayer2(user);
        room.setPlayer2DecklistId(dto.getDecklistId2());
        room.setStatus(RoomStatus.CREATING_DUEL);
        roomRepository.save(room);

        try {
            // With skipRps=true, OCGCore player 0 always goes first.
            // Swap deck order so the chosen player's deck becomes player 0.
            var firstDeck = extractDeck(p2First ? deckCards2 : deckCards1);
            var secondDeck = extractDeck(p2First ? deckCards1 : deckCards2);
            validatePasscodesOrThrow(firstDeck, p2First ? deckCards2 : deckCards1,
                    secondDeck, p2First ? deckCards1 : deckCards2);
            var response = duelServerClient.createDuel(
                    user.getId().toString(),
                    firstDeck,
                    user.getId().toString(),
                    secondDeck,
                    true,
                    dto.isSkipShuffle()
            );

            if (response == null || response.getWsTokens() == null || response.getWsTokens().length < 2) {
                throw new RestClientException("Invalid duel server response");
            }

            // Swap wsTokens so token1 always maps to P1's connection, token2 to P2's.
            var token1 = p2First ? response.getWsTokens()[1] : response.getWsTokens()[0];
            var token2 = p2First ? response.getWsTokens()[0] : response.getWsTokens()[1];

            room.setDuelServerId(response.getDuelId());
            room.setWsToken1(token1);
            room.setWsToken2(token2);
            room.setStatus(RoomStatus.ACTIVE);
            roomRepository.save(room);

            var result = new QuickDuelResponseDTO();
            result.setRoomCode(room.getRoomCode());
            result.setWsToken1(token1);
            result.setWsToken2(token2);
            return result;
        } catch (RestClientException e) {
            room.setStatus(RoomStatus.ENDED);
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

    /**
     * Validates that all passcodes in both decks exist in the duel server's cards.cdb.
     * Throws a 422 with card names if any are missing.
     */
    private void validatePasscodesOrThrow(DuelDeckDTO deck1, List<CardDeckIndex> deck1Cards,
                                          DuelDeckDTO deck2, List<CardDeckIndex> deck2Cards) {
        var allPasscodes = new java.util.ArrayList<Integer>();
        for (int code : deck1.getMain()) allPasscodes.add(code);
        for (int code : deck1.getExtra()) allPasscodes.add(code);
        for (int code : deck2.getMain()) allPasscodes.add(code);
        for (int code : deck2.getExtra()) allPasscodes.add(code);

        var uniquePasscodes = allPasscodes.stream().distinct().toList();

        // Check Spring DB first — cards should always be in our DB
        var uniquePasscodesLong = uniquePasscodes.stream().map(Integer::longValue).toList();
        var savedCards = cardRepository.findAllByPasscodeIn(uniquePasscodesLong);
        var savedPasscodes = savedCards.stream().map(c -> c.getPasscode().intValue()).collect(Collectors.toSet());
        var missingInDb = uniquePasscodes.stream().filter(code -> !savedPasscodes.contains(code)).toList();
        if (!missingInDb.isEmpty()) {
            log.error("Cards in deck but missing from database: {}", missingInDb);
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Card data inconsistency — " + missingInDb.size() + " card(s) not found in database. Try re-syncing cards from the Parameters page.");
        }

        // Check duel server — cards.cdb might be outdated
        var missingPasscodes = duelServerClient.findMissingPasscodes(uniquePasscodes);

        if (missingPasscodes.isEmpty()) return;

        // Build passcode → card name map for a user-friendly error message
        var allCards = new java.util.ArrayList<>(deck1Cards);
        allCards.addAll(deck2Cards);
        var passcodeToName = allCards.stream()
                .collect(Collectors.toMap(
                        c -> c.getCard().getPasscode().intValue(),
                        c -> c.getCard().getName(),
                        (a, b) -> a
                ));

        var unknownCards = missingPasscodes.stream()
                .map(code -> passcodeToName.getOrDefault(code, "passcode=" + code))
                .distinct()
                .toList();

        log.warn("Deck contains cards unknown to duel engine: {}", unknownCards);
        throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                "Cards not recognized by duel engine (passcode mismatch): " + String.join(", ", unknownCards)
                        + ". Try updating duel server data from the Parameters page.");
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
