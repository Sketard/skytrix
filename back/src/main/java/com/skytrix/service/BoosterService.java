package com.skytrix.service;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.mapper.CardMapper;
import com.skytrix.mapper.RoomMapper;
import com.skytrix.model.dto.booster.BoosterDeckDTO;
import com.skytrix.model.dto.booster.BoosterStateDTO;
import com.skytrix.model.dto.booster.PulledCardDTO;
import com.skytrix.model.dto.room.DuelDeckDTO;
import com.skytrix.model.dto.room.RoomDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.Room;
import com.skytrix.model.entity.RoomBoosterCard;
import com.skytrix.model.enums.DeckKeyword;
import com.skytrix.model.enums.RoomStatus;
import com.skytrix.repository.CardRepository;
import com.skytrix.repository.CardSetRepository;
import com.skytrix.repository.RoomBoosterCardRepository;
import com.skytrix.repository.RoomRepository;
import com.skytrix.security.AuthService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Booster mode: each player opens {@code boosterCount} boosters of the room's
 * set, builds a deck from what they pulled, then marks themselves ready. The
 * creator starts the duel once both are ready ({@link RoomService#startDuel}).
 * No ban-list and no copy limit apply: a player may run every copy they pulled.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class BoosterService {

    public static final int CARDS_PER_BOOSTER = 5;

    private static final Random RANDOM = new SecureRandom();

    private final RoomRepository roomRepository;
    private final RoomBoosterCardRepository boosterCardRepository;
    private final CardSetRepository cardSetRepository;
    private final CardRepository cardRepository;
    private final DuelServerClient duelServerClient;
    private final AuthService authService;
    private final CardMapper cardMapper;
    private final RoomMapper roomMapper;
    private final RoomEventService roomEventService;

    /** A booster deck ready for the duel-server, plus its cards for error messages. */
    public record BuiltDeck(DuelDeckDTO deck, List<Card> cards) {}

    /**
     * Card ids of the set that the duel engine knows. Cards missing from the
     * engine's cards.cdb are left out of the pool: a duel with them would be
     * refused at start.
     */
    public List<Long> playablePool(String setName) {
        var rows = cardSetRepository.findCardIdsAndPasscodesBySetName(setName);
        var passcodes = rows.stream().map(r -> ((Long) r[1]).intValue()).distinct().toList();
        var missing = new HashSet<>(duelServerClient.findMissingPasscodes(passcodes));
        return rows.stream()
                .filter(r -> !missing.contains(((Long) r[1]).intValue()))
                .map(r -> (Long) r[0])
                .distinct()
                .toList();
    }

    @Transactional(readOnly = true)
    public BoosterStateDTO getState(String roomCode) {
        var userId = authService.getConnectedUserId();
        var room = findBoosterRoom(roomCode);
        requireParticipant(room, userId);
        return toState(room, userId, boosterCardRepository
                .findByRoomIdAndUserIdOrderByBoosterIndexAscSlotIndexAsc(room.getId(), userId));
    }

    /**
     * Opens the connected player's next booster: {@value #CARDS_PER_BOOSTER}
     * cards drawn uniformly, with repeats, among the playable cards of the set.
     * Returns the new cards.
     */
    @Transactional
    public List<PulledCardDTO> openNextBooster(String roomCode) {
        var userId = authService.getConnectedUserId();
        // Pool first: it calls the duel-server, so keep it out of the row lock.
        var setName = findBoosterRoom(roomCode).getBoosterSetName();
        var pool = playablePool(setName);
        if (pool.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "No card of the set " + setName + " is playable");
        }

        var room = roomRepository.findByRoomCodeForUpdate(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        requireParticipant(room, userId);
        requireBuildingPhase(room);

        var opened = boosterCardRepository.countOpenedBoosters(room.getId(), userId);
        if (opened >= room.getBoosterCount()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Every booster is already open");
        }

        var drawnIds = drawBooster(pool, RANDOM);
        // findAllById collapses repeats — map the drawn ids back onto the entities.
        var cardsById = new HashMap<Long, Card>();
        cardRepository.findAllById(drawnIds).forEach(c -> cardsById.put(c.getId(), c));

        var pulled = new ArrayList<RoomBoosterCard>();
        for (int slot = 0; slot < drawnIds.size(); slot++) {
            var row = new RoomBoosterCard();
            row.setRoom(room);
            row.setUserId(userId);
            row.setBoosterIndex(opened);
            row.setSlotIndex(slot);
            row.setCard(cardsById.get(drawnIds.get(slot)));
            pulled.add(row);
        }
        boosterCardRepository.saveAll(pulled);
        return pulled.stream().map(this::toPulledCard).toList();
    }

    /**
     * Saves the deck the connected player built from their pulls and marks
     * them ready. Each id is a pulled copy; extra-deck cards go to the extra
     * deck, every other card to the main deck.
     */
    @Transactional
    public RoomDTO submitDeck(String roomCode, BoosterDeckDTO dto) {
        var userId = authService.getConnectedUserId();
        var room = roomRepository.findByRoomCodeForUpdate(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        requireBooster(room);
        requireParticipant(room, userId);
        requireBuildingPhase(room);

        var pulls = boosterCardRepository
                .findByRoomIdAndUserIdOrderByBoosterIndexAscSlotIndexAsc(room.getId(), userId);
        var pullsById = new HashMap<Long, RoomBoosterCard>();
        pulls.forEach(p -> pullsById.put(p.getId(), p));

        validateDeck(room, dto, pullsById);

        pulls.forEach(p -> {
            p.setDeckZone(null);
            p.setDeckIndex(null);
        });
        assignZone(dto.getMain(), DeckKeyword.MAIN, pullsById);
        assignZone(dto.getExtra(), DeckKeyword.EXTRA, pullsById);
        boosterCardRepository.saveAll(pulls);

        setReady(room, userId, true);
        return broadcastUpdate(room, userId);
    }

    /** The connected player goes back to editing their deck. */
    @Transactional
    public RoomDTO unready(String roomCode) {
        var userId = authService.getConnectedUserId();
        var room = roomRepository.findByRoomCodeForUpdate(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        requireBooster(room);
        requireParticipant(room, userId);
        requireBuildingPhase(room);
        setReady(room, userId, false);
        return broadcastUpdate(room, userId);
    }

    /** The submitted deck of a player, in deck order. Called once both players are ready. */
    @Transactional(readOnly = true)
    public BuiltDeck buildDeck(Long roomId, Long userId) {
        var inDeck = boosterCardRepository.findByRoomIdAndUserIdOrderByBoosterIndexAscSlotIndexAsc(roomId, userId)
                .stream()
                .filter(p -> p.getDeckZone() != null)
                .sorted(Comparator.comparingInt(p -> p.getDeckIndex() == null ? Integer.MAX_VALUE : p.getDeckIndex()))
                .toList();
        var main = passcodes(inDeck, DeckKeyword.MAIN);
        var extra = passcodes(inDeck, DeckKeyword.EXTRA);
        var cards = inDeck.stream().map(RoomBoosterCard::getCard).toList();
        return new BuiltDeck(new DuelDeckDTO(main, extra), cards);
    }

    /** A player leaves a booster room (kicked): their pulls go with them. */
    public void discardPulls(Long roomId, Long userId) {
        boosterCardRepository.deleteByRoomIdAndUserId(roomId, userId);
    }

    // ---------- package-private for tests ----------

    /** Draws {@value #CARDS_PER_BOOSTER} card ids uniformly, with repeats. */
    static List<Long> drawBooster(List<Long> pool, Random random) {
        var drawn = new ArrayList<Long>(CARDS_PER_BOOSTER);
        for (int i = 0; i < CARDS_PER_BOOSTER; i++) {
            drawn.add(pool.get(random.nextInt(pool.size())));
        }
        return drawn;
    }

    // ---------- private helpers ----------

    private void validateDeck(Room room, BoosterDeckDTO dto, Map<Long, RoomBoosterCard> pullsById) {
        var seen = new HashSet<Long>();
        for (var id : concat(dto.getMain(), dto.getExtra())) {
            if (!pullsById.containsKey(id)) {
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Card not pulled by this player");
            }
            if (!seen.add(id)) {
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "A pulled card is used twice");
            }
        }
        for (var id : dto.getMain()) {
            if (pullsById.get(id).getCard().isExtraCard()) {
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                        nameOf(pullsById.get(id).getCard()) + " belongs to the Extra Deck");
            }
        }
        for (var id : dto.getExtra()) {
            if (!pullsById.get(id).getCard().isExtraCard()) {
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                        nameOf(pullsById.get(id).getCard()) + " belongs to the Main Deck");
            }
        }
        int min = room.getMinMainDeckSize();
        int max = DeckKeyword.MAIN.getMaxSize();
        if (dto.getMain().size() < min || dto.getMain().size() > max) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Main Deck must have " + min + "-" + max + " cards (has " + dto.getMain().size() + ")");
        }
        if (dto.getExtra().size() > DeckKeyword.EXTRA.getMaxSize()) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Extra Deck must have at most " + DeckKeyword.EXTRA.getMaxSize()
                            + " cards (has " + dto.getExtra().size() + ")");
        }
    }

    /** Card name for an error message; falls back to the passcode when the card has no translation. */
    private static String nameOf(Card card) {
        try {
            var name = card.getName();
            if (name != null) return name;
        } catch (RuntimeException ignored) {
            // getName() dereferences a missing translation
        }
        return "#" + card.getPasscode();
    }

    private static List<Long> concat(List<Long> a, List<Long> b) {
        var all = new ArrayList<Long>(a);
        all.addAll(b);
        return all;
    }

    private static void assignZone(List<Long> ids, DeckKeyword zone, Map<Long, RoomBoosterCard> pullsById) {
        for (int i = 0; i < ids.size(); i++) {
            var pull = pullsById.get(ids.get(i));
            pull.setDeckZone(zone);
            pull.setDeckIndex(i);
        }
    }

    private static int[] passcodes(List<RoomBoosterCard> inDeck, DeckKeyword zone) {
        return inDeck.stream()
                .filter(p -> p.getDeckZone() == zone)
                .mapToInt(p -> p.getCard().getPasscode().intValue())
                .toArray();
    }

    private void setReady(Room room, Long userId, boolean ready) {
        if (userId.equals(room.getPlayer1().getId())) {
            room.setPlayer1Ready(ready);
        } else {
            room.setPlayer2Ready(ready);
        }
        roomRepository.save(room);
    }

    /** Pushes the new ready flags to both participants once the tx commits. */
    private RoomDTO broadcastUpdate(Room room, Long userId) {
        var dtoByUser = new HashMap<Long, RoomDTO>();
        dtoByUser.put(room.getPlayer1().getId(), roomMapper.toRoomDTO(room, room.getPlayer1().getId()));
        if (room.getPlayer2() != null) {
            dtoByUser.put(room.getPlayer2().getId(), roomMapper.toRoomDTO(room, room.getPlayer2().getId()));
        }
        var roomCode = room.getRoomCode();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                roomEventService.sendRoomUpdated(roomCode, dtoByUser);
            }
        });
        return dtoByUser.get(userId);
    }

    private BoosterStateDTO toState(Room room, Long userId, List<RoomBoosterCard> pulls) {
        var state = new BoosterStateDTO();
        state.setSetName(room.getBoosterSetName());
        state.setBoosterCount(room.getBoosterCount());
        state.setOpenedBoosters((int) pulls.stream().map(RoomBoosterCard::getBoosterIndex).distinct().count());
        state.setMinMainDeckSize(room.getMinMainDeckSize());
        state.setMaxMainDeckSize(DeckKeyword.MAIN.getMaxSize());
        state.setMaxExtraDeckSize(DeckKeyword.EXTRA.getMaxSize());
        state.setReady(userId.equals(room.getPlayer1().getId()) ? room.isPlayer1Ready() : room.isPlayer2Ready());
        state.setCards(pulls.stream().map(this::toPulledCard).toList());
        return state;
    }

    private PulledCardDTO toPulledCard(RoomBoosterCard pull) {
        var dto = new PulledCardDTO();
        dto.setId(pull.getId());
        dto.setBoosterIndex(pull.getBoosterIndex());
        dto.setSlotIndex(pull.getSlotIndex());
        var card = cardMapper.toCardDetailedDTO(pull.getCard(), java.util.Set.of());
        // Prints of the card are not needed to open or build — keep the payload light.
        card.setSets(List.of());
        dto.setCard(card);
        dto.setDeckZone(pull.getDeckZone());
        dto.setDeckIndex(pull.getDeckIndex());
        return dto;
    }

    private Room findBoosterRoom(String roomCode) {
        var room = roomRepository.findByRoomCode(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        requireBooster(room);
        return room;
    }

    private static void requireBooster(Room room) {
        if (!room.isBooster()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Not a booster room");
        }
    }

    private static void requireParticipant(Room room, Long userId) {
        boolean isCreator = userId.equals(room.getPlayer1().getId());
        boolean isJoiner = room.getPlayer2() != null && userId.equals(room.getPlayer2().getId());
        if (!isCreator && !isJoiner) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not a participant of this room");
        }
    }

    /** Boosters are opened and decks built before the duel starts. */
    private static void requireBuildingPhase(Room room) {
        if (room.getStatus() != RoomStatus.WAITING && room.getStatus() != RoomStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The duel has already started");
        }
    }
}
