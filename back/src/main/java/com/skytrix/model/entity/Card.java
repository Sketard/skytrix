package com.skytrix.model.entity;

import com.skytrix.model.dto.yugipro.YugiproCardDTO;
import com.skytrix.model.enums.Attribute;
import com.skytrix.model.enums.Language;
import com.skytrix.model.enums.Race;
import com.skytrix.model.enums.Type;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OneToMany;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.BatchSize;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static com.skytrix.model.enums.Language.EN;
import static com.skytrix.model.enums.Language.FR;
import static com.skytrix.utils.CoreUtils.filter;
import static com.skytrix.utils.CoreUtils.mapToList;

@Entity
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
public class Card {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private Long passcode;
    private List<String> types;
    private String frameType;
    private Integer atk;
    private Integer def;
    private Short level;
    private String race;
    @Enumerated(EnumType.STRING)
    private Attribute attribute;
    private String archetype;
    private Short scale;
    private Short linkval;
    private List<String> linkmarkers;
    private Short banInfo;
    private Integer genesysPoint;

    // sets / images / translations were FetchType.EAGER — each list triggered
    // a JOIN, producing a cartesian product (a 30-card page = ~1500 rows) AND
    // an N+1 across every card-serving endpoint (/cards/search of 30 cards ran
    // 122 SQL queries — perf-audit chantier finding B-C1). Now LAZY + @BatchSize:
    // Hibernate loads each collection for the whole page in one
    // `... WHERE card_id IN (?, ?, …)` — 3 batched queries instead of ~90.
    // @BatchSize is used (not JOIN FETCH) because three List collections cannot
    // be join-fetched together — that throws MultipleBagFetchException.
    @OneToMany(mappedBy = "card", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @BatchSize(size = 100)
    private List<CardSet> sets = new ArrayList<>();

    @OneToMany(mappedBy = "card", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @BatchSize(size = 100)
    private List<CardImage> images = new ArrayList<>();

    @OneToMany(mappedBy = "card", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @BatchSize(size = 100)
    @Getter(AccessLevel.NONE)
    @Setter(AccessLevel.NONE)
    private List<Translation> translations = new ArrayList<>();

    private LocalDate firstTcgRelease;

    @ManyToMany
    @JoinTable(
            name = "favorite_cards",
            joinColumns = @JoinColumn(name = "card_id"), inverseJoinColumns = @JoinColumn(name = "user_id")
    )
    private List<User> favoritedBy;


    public void addTranslation(String cardName, String description, Language language) {
        var existing = translations.stream()
                .filter(t -> t.getLanguage() == language)
                .findFirst()
                .orElse(null);
        if (existing != null) {
            existing.setName(cardName);
            existing.setDescription(description);
        } else {
            var trad = Translation.builder()
                .name(cardName)
                .description(description)
                .language(language)
                .build();
            translations.add(trad);
            trad.setCard(this);
        }
    }
    public void addTranslation(YugiproCardDTO cardDTO, Language language) {
        if (cardDTO == null) {
            return;
        }
        addTranslation(cardDTO.getName(), cardDTO.getDescription(), language);
    }

    public boolean hasTranslation(Language language) {
        return translations.stream().anyMatch( t -> t.getLanguage() == language);
    }

    public void setImages(List<CardImage> newImages) {
        images = new ArrayList<>();
        newImages.forEach(this::addImage);
    }

    public void setSets(List<CardSet> newSets) {
        sets = new ArrayList<>();
        newSets.forEach(this::addSet);
    }

    public void addImage(CardImage image) {
        images.add(image);
        image.setCard(this);
    }

    public void addSet(CardSet set) {
        sets.add(set);
        set.setCard(this);
    }

    public String getName() {
        return getTranslation(FR).getName();
    }

    public String getDescription() {
        return getTranslation(FR).getDescription();
    }

    public Race getRace() {
        return Race.getRace(race);
    }

    public Translation getTranslation(Language language) {
        var translation = filter(translations, trad -> trad.getLanguage() == language).stream().findAny().orElse(null);
        if (translation != null) {
            return translation;
        }
        return filter(translations, trad -> trad.getLanguage() == EN).stream().findAny().orElse(null);
    }

    public boolean isExtraCard() {
        return getTypes().stream().anyMatch(t -> Type.getExtraType().contains(t));
    }

    public List<Type> getTypes() {
        return Type.getType(types);
    }
}
