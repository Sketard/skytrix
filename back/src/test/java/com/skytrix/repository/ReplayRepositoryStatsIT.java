package com.skytrix.repository;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.sql.DriverManager;
import java.util.List;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase.Replace;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.skytrix.model.dto.replay.ReplayData;
import com.skytrix.model.dto.replay.ReplayDeck;
import com.skytrix.model.dto.replay.ReplayMetadata;
import com.skytrix.model.entity.Replay;
import com.skytrix.model.entity.User;
import com.skytrix.model.enums.DuelResult;
import com.skytrix.model.enums.Role;

/**
 * Integration test for ReplayRepository.getStatsForUser native Postgres query.
 *
 * Requires a running Postgres on localhost:15432 with user=test, password=test, db=test.
 * Start one with: docker run --rm -d --name skytrix-postgres-test -e POSTGRES_PASSWORD=test
 *   -e POSTGRES_USER=test -e POSTGRES_DB=test -p 15432:5432 postgres:16-alpine
 *
 * Testcontainers was tried but Docker 29 + Spring Boot 3.4 BOM (testcontainers 1.20.4)
 * produces a Docker API mismatch ("Could not find a valid Docker environment").
 * Manual container is a pragmatic workaround until Spring Boot bumps testcontainers
 * to >=1.20.6 OR the local Docker Desktop downgrades to engine <=28.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = Replace.NONE)
class ReplayRepositoryStatsIT {

    private static final String JDBC_URL = "jdbc:postgresql://localhost:15432/test";

    @BeforeAll
    static void checkPostgresReachable() {
        try (var ignored = DriverManager.getConnection(JDBC_URL, "test", "test")) {
            // ok
        } catch (Exception e) {
            assumeTrue(false, "Postgres not reachable at " + JDBC_URL + " — skipping IT: " + e.getMessage());
        }
    }

    @DynamicPropertySource
    static void overrideDatasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL);
        registry.add("spring.datasource.username", () -> "test");
        registry.add("spring.datasource.password", () -> "test");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.flyway.locations", () -> "classpath:db/migration/flyway");
        registry.add("spring.flyway.clean-disabled", () -> "false");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
    }

    @Autowired
    private ReplayRepository replayRepository;

    @Autowired
    private UserRepository userRepository;

    @Test
    void getStatsForUser_countsVictoriesDefeatsAndDraws() {
        User alice = createUser("alice");
        User bob = createUser("bob");

        persistReplay(alice, bob, DuelResult.VICTORY);
        persistReplay(alice, bob, DuelResult.OPPONENT_TIMEOUT);
        persistReplay(alice, bob, DuelResult.DEFEAT);
        persistReplay(bob, alice, DuelResult.DEFEAT);
        persistReplay(bob, alice, DuelResult.VICTORY);
        persistReplay(alice, bob, DuelResult.DRAW);

        var stats = replayRepository.getStatsForUser(alice.getId());

        assertEquals(6, stats.getTotal());
        assertEquals(3, stats.getVictories(),
                "alice has 2 wins as player1 + 1 win as player2 (bob played and lost)");
        assertEquals(2, stats.getDefeats(),
                "alice has 1 loss as player1 + 1 loss as player2");
        assertEquals(1, stats.getDraws());
    }

    @Test
    void getStatsForUser_flipsResultsForPlayer2Perspective() {
        User alice = createUser("alice2");
        User bob = createUser("bob2");

        persistReplay(alice, bob, DuelResult.VICTORY);
        persistReplay(alice, bob, DuelResult.OPPONENT_TIMEOUT);
        persistReplay(alice, bob, DuelResult.DEFEAT);
        persistReplay(alice, bob, DuelResult.SURRENDER);

        var stats = replayRepository.getStatsForUser(bob.getId());

        assertEquals(4, stats.getTotal());
        assertEquals(2, stats.getVictories(), "bob wins when alice loses (DEFEAT/SURRENDER)");
        assertEquals(2, stats.getDefeats(), "bob loses when alice wins (VICTORY/OPPONENT_TIMEOUT)");
        assertEquals(0, stats.getDraws());
    }

    @Test
    void getStatsForUser_returnsZeroesForUnknownUser() {
        var stats = replayRepository.getStatsForUser(99999L);

        assertEquals(0, stats.getTotal());
        assertEquals(0, stats.getVictories());
        assertEquals(0, stats.getDefeats());
        assertEquals(0, stats.getDraws());
    }

    private User createUser(String pseudo) {
        User u = User.builder()
                .pseudo(pseudo + "-" + System.nanoTime())
                .password("x")
                .role(Role.USER)
                .build();
        return userRepository.save(u);
    }

    private void persistReplay(User p1, User p2, DuelResult result) {
        ReplayMetadata meta = new ReplayMetadata(
                List.of(p1.getPseudo(), p2.getPseudo()),
                List.of("d1", "d2"),
                5,
                result,
                "2026-05-14T10:00:00Z",
                "h",
                "v",
                300
        );
        ReplayDeck deck = new ReplayDeck(List.of(), List.of());
        ReplayData data = new ReplayData(
                List.of("0", "0", "0", "0"),
                List.of(deck, deck),
                List.of()
        );
        Replay replay = new Replay();
        replay.setPlayer1(p1);
        replay.setPlayer2(p2);
        replay.setMetadata(meta);
        replay.setReplayData(data);
        replayRepository.save(replay);
    }
}
