package com.skytrix.model.entity;

import com.skytrix.model.enums.DeckKeyword;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One card pulled by a player from a booster of a booster-mode room. */
@Entity
@NoArgsConstructor
@Getter
@Setter
public class RoomBoosterCard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    private Room room;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    private int boosterIndex;
    private int slotIndex;

    @ManyToOne
    private Card card;

    /** MAIN / EXTRA once the copy is in the submitted deck, null otherwise. */
    @Enumerated(EnumType.STRING)
    private DeckKeyword deckZone;

    private Integer deckIndex;
}
