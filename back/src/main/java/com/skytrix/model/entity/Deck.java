package com.skytrix.model.entity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

import static com.skytrix.utils.CoreUtils.filter;
import static com.skytrix.utils.CoreUtils.mapToList;

import com.skytrix.model.enums.DeckKeyword;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Entity
public class Deck {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    @OneToMany(mappedBy = "deck", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ImageIndex> images = new ArrayList<>();

    @OneToMany(mappedBy = "deck", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CardDeckIndex> cardsIndexed = new ArrayList<>();

    @ManyToOne(fetch = FetchType.LAZY)
    private User user;

    public void addCard(CardDeckIndex card) {
        if (cardsIndexed == null) {
            cardsIndexed = new ArrayList<>();
        }
        cardsIndexed.add(card);
    }

    public void addCards(List<CardDeckIndex> cards) {
        if (cardsIndexed == null) {
            cardsIndexed = new ArrayList<>();
        }
        cardsIndexed.addAll(cards);
    }

    public void addImages(List<ImageIndex> imagesIndexes) {
        if (images == null) {
            images = new ArrayList<>();
        }
        images.addAll(imagesIndexes);
    }

    public List<Card> getExtraDeck() {
        return mapToList(getExtraDeckIndexed(), CardDeckIndex::getCard);
    }

    public  List<Card> getMainDeck() {
        return mapToList(getMainDeckIndexed(), CardDeckIndex::getCard);
    }

    public  List<Card> getSideDeck() {
        return mapToList(getSideDeckIndexed(), CardDeckIndex::getCard);
    }

    public  List<CardDeckIndex> getMainDeckIndexed() {
        return filter(cardsIndexed, c -> c.getType() == DeckKeyword.MAIN);
    }

    public List<CardDeckIndex> getExtraDeckIndexed() {
        return filter(cardsIndexed, c -> c.getType() == DeckKeyword.EXTRA);
    }

    public  List<CardDeckIndex> getSideDeckIndexed() {
        return filter(cardsIndexed, c -> c.getType() == DeckKeyword.SIDE);
    }

}
