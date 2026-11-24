package com.skytrix.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Random;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.mapper.CardMapper;
import com.skytrix.mapper.RoomMapper;
import com.skytrix.model.dto.booster.BoosterDeckDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.Room;
import com.skytrix.model.entity.RoomBoosterCard;
import com.skytrix.model.entity.User;
import com.skytrix.model.enums.DeckKeyword;
import com.skytrix.model.enums.RoomMode;
import com.skytrix.model.enums.RoomStatus;
import com.skytrix.repository.CardRepository;
import com.skytrix.repository.CardSetRepository;
import com.skytrix.repository.RoomBoosterCardRepository;
import com.skytrix.repository.RoomRepository;
import com.skytrix.security.AuthService;

@ExtendWith(MockitoExtension.class)
class BoosterServiceTest {

    private static final long CREATOR = 1L;
    private static final long ROOM_ID = 10L;
    private static final String CODE = "ABCDEF";

    @Mock private RoomRepository roomRepository;
    @Mock private RoomBoosterCardRepository boosterCardRepository;
    @Mock private CardSetRepository cardSetRepository;
    @Mock private CardRepository cardRepository;
    @Mock private DuelServerClient duelServerClient;
    @Mock private AuthService authService;
    @Mock private CardMapper cardMapper;
    @Mock private RoomMapper roomMapper;
    @Mock private RoomEventService roomEventService;

    @InjectMocks
    private BoosterService boosterService;

    private Room room;
    private List<RoomBoosterCard> pulls;

    @BeforeEach
    void setUp() {
        TransactionSynchronizationManager.initSynchronization();
        room = new Room();
        room.setId(ROOM_ID);
        room.setRoomCode(CODE);
        room.setMode(RoomMode.BOOSTER);
        room.setStatus(RoomStatus.READY);
        room.setBoosterSetName("Legend of Blue Eyes White Dragon");
        room.setBoosterCount(2);
        room.setMinMainDeckSize(3);
        room.setPlayer1(User.builder().id(CREATOR).pseudo("creator").build());
        room.setPlayer2(User.builder().id(2L).pseudo("joiner").build());

        // 4 main-deck pulls (ids 100-103) and one Fusion (id 104).
        pulls = new ArrayList<>();
        for (long i = 0; i < 4; i++) pulls.add(pull(100 + i, "MONSTER", "NORMAL"));
        pulls.add(pull(104, "MONSTER", "FUSION"));
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    @Test
    void drawBooster_drawsFiveCardsFromThePool() {
        var pool = List.of(1L, 2L, 3L);
        var drawn = BoosterService.drawBooster(pool, new Random(42));
        assertEquals(BoosterService.CARDS_PER_BOOSTER, drawn.size());
        assertTrue(pool.containsAll(drawn));
    }

    @Test
    void drawBooster_repeatsCardsOfASmallPool() {
        var drawn = BoosterService.drawBooster(List.of(7L), new Random(1));
        assertEquals(List.of(7L, 7L, 7L, 7L, 7L), drawn);
    }

    @Test
    void submitDeck_assignsZonesInOrderAndMarksReady() {
        givenRoomAndPulls();

        boosterService.submitDeck(CODE, deck(List.of(102L, 100L, 101L), List.of(104L)));

        assertTrue(room.isPlayer1Ready());
        assertFalse(room.isPlayer2Ready());
        assertEquals(DeckKeyword.MAIN, byId(102).getDeckZone());
        assertEquals(0, byId(102).getDeckIndex());
        assertEquals(1, byId(100).getDeckIndex());
        assertEquals(DeckKeyword.EXTRA, byId(104).getDeckZone());
        assertNull(byId(103).getDeckZone(), "a pull left out stays in the pool");
        verify(boosterCardRepository).saveAll(anyList());
    }

    @Test
    void submitDeck_rejectsAMainDeckBelowTheRoomMinimum() {
        givenRoomAndPulls();
        assertThrows(ResponseStatusException.class,
                () -> boosterService.submitDeck(CODE, deck(List.of(100L, 101L), List.of())));
        assertFalse(room.isPlayer1Ready());
    }

    @Test
    void submitDeck_rejectsAnExtraDeckCardInTheMainDeck() {
        givenRoomAndPulls();
        assertThrows(ResponseStatusException.class,
                () -> boosterService.submitDeck(CODE, deck(List.of(100L, 101L, 104L), List.of())));
    }

    @Test
    void submitDeck_rejectsACardPulledByNobody() {
        givenRoomAndPulls();
        assertThrows(ResponseStatusException.class,
                () -> boosterService.submitDeck(CODE, deck(List.of(100L, 101L, 999L), List.of())));
    }

    @Test
    void submitDeck_rejectsTheSameCopyTwice() {
        givenRoomAndPulls();
        assertThrows(ResponseStatusException.class,
                () -> boosterService.submitDeck(CODE, deck(List.of(100L, 100L, 101L), List.of())));
    }

    @Test
    void submitDeck_rejectsOnceTheDuelHasStarted() {
        givenRoomAndPulls();
        room.setStatus(RoomStatus.ACTIVE);
        assertThrows(ResponseStatusException.class,
                () -> boosterService.submitDeck(CODE, deck(List.of(100L, 101L, 102L), List.of())));
    }

    @Test
    void buildDeck_returnsPasscodesInDeckOrder() {
        byId(101).setDeckZone(DeckKeyword.MAIN);
        byId(101).setDeckIndex(1);
        byId(103).setDeckZone(DeckKeyword.MAIN);
        byId(103).setDeckIndex(0);
        byId(104).setDeckZone(DeckKeyword.EXTRA);
        byId(104).setDeckIndex(0);
        when(boosterCardRepository.findByRoomIdAndUserIdOrderByBoosterIndexAscSlotIndexAsc(ROOM_ID, CREATOR))
                .thenReturn(pulls);

        var built = boosterService.buildDeck(ROOM_ID, CREATOR);

        assertEquals(List.of(1103, 1101), toList(built.deck().getMain()));
        assertEquals(List.of(1104), toList(built.deck().getExtra()));
    }

    // ---------- helpers ----------

    private void givenRoomAndPulls() {
        when(authService.getConnectedUserId()).thenReturn(CREATOR);
        when(roomRepository.findByRoomCodeForUpdate(CODE)).thenReturn(Optional.of(room));
        // Unused by the tests that fail before loading the pulls (finished duel).
        org.mockito.Mockito.lenient()
                .when(boosterCardRepository.findByRoomIdAndUserIdOrderByBoosterIndexAscSlotIndexAsc(ROOM_ID, CREATOR))
                .thenReturn(pulls);
    }

    private RoomBoosterCard pull(long id, String... types) {
        var card = new Card();
        card.setId(id);
        card.setPasscode(1000 + id);
        card.setTypes(List.of(types));
        var pull = new RoomBoosterCard();
        pull.setId(id);
        pull.setRoom(room);
        pull.setUserId(CREATOR);
        pull.setCard(card);
        return pull;
    }

    private RoomBoosterCard byId(long id) {
        return pulls.stream().filter(p -> p.getId() == id).findFirst().orElseThrow();
    }

    private static BoosterDeckDTO deck(List<Long> main, List<Long> extra) {
        var dto = new BoosterDeckDTO();
        dto.setMain(main);
        dto.setExtra(extra);
        return dto;
    }

    private static List<Integer> toList(int[] values) {
        return java.util.Arrays.stream(values).boxed().toList();
    }
}
