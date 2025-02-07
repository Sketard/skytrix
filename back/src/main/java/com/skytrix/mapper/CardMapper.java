package com.skytrix.mapper;

import jakarta.inject.Inject;

import static com.skytrix.utils.CoreUtils.getNullSafe;
import static com.skytrix.utils.CoreUtils.mapToList;

import org.mapstruct.AfterMapping;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

import com.skytrix.model.dto.card.CardDTO;
import com.skytrix.model.dto.card.CardDetailedDTO;
import com.skytrix.model.dto.card.CardImageDTO;
import com.skytrix.model.dto.card.CardPossessedDTO;
import com.skytrix.model.dto.card.CardSetDTO;
import com.skytrix.model.dto.card.ShortCardPossessedDTO;
import com.skytrix.model.dto.deck.IndexedCardDetailDTO;
import com.skytrix.model.dto.deck.IndexedCardImageDTO;
import com.skytrix.model.dto.yugipro.YugiproCardDTO;
import com.skytrix.model.dto.yugipro.YugiproImageDTO;
import com.skytrix.model.dto.yugipro.YugiproSetDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardDeckIndex;
import com.skytrix.model.entity.CardImage;
import com.skytrix.model.entity.CardPossessed;
import com.skytrix.model.entity.CardSet;
import com.skytrix.model.entity.ImageIndex;
import com.skytrix.model.enums.Language;
import com.skytrix.model.enums.Type;
import com.skytrix.repository.CardRepository;
import com.skytrix.security.AuthService;
import com.skytrix.utils.RouteUtils;

@Mapper(componentModel = "spring")
public abstract class CardMapper {
    @Inject
    private CardRepository cardRepository;

    @Inject
    private AuthService authService;

    @Mapping(target = "id", ignore = true)
    public abstract CardSet toCardSet(YugiproSetDTO source);


    @Mapping(target = "id", ignore = true)
    @Mapping(target = "imageId", source = "id")
    public abstract CardImage toCardImage(YugiproImageDTO source);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "sets", ignore = true)
    @Mapping(target = "banInfo", ignore = true)
    @Mapping(target = "types", ignore = true)
    @Mapping(target = "passcode", source = "source.id")
    public abstract Card toCard(YugiproCardDTO source, Language cardLanguage);

    @AfterMapping
    public void toCardAfterMapping(@MappingTarget Card target, YugiproCardDTO source, Language cardLanguage) {
        var images = mapToList(getNullSafe(source.getImages()), this::toCardImage);
        target.setImages(images);
        var sets = mapToList(getNullSafe(source.getSets()), this::toCardSet);
        target.setSets(sets);
        target.addTranslation(source, cardLanguage);
        target.setBanInfo(source.getTcgBanInfo());
        target.setFirstTcgRelease(source.getFirstTcgRelease());
        target.setTypes(mapToList(Type.getType(source.getType()), Type::name));
    }

    @Mapping(target = "cardId", source = "source.card.id")
    public abstract CardSetDTO toCardSetDTO(CardSet source);

    @Mapping(target = "cardId", source = "source.card.id")
    @Mapping(target = "url", ignore = true)
    public abstract CardImageDTO toCardImageDTO(CardImage source);

    @AfterMapping
    public void toCardImageDTOAfterMapping(@MappingTarget CardImageDTO target, CardImage source) {
        var id = source.getId();
        target.setUrl(RouteUtils.getBigImageRoute(id));
        target.setSmallUrl(RouteUtils.getSmallImageRoute(id));
    }

    @Mapping(target = "name", source = "source.name")
    @Mapping(target = "description", source = "source.description")
    public abstract CardDTO toCardDTO(Card source);

    @Mapping(source = "cardSet.id", target = "cardSetId")
    public abstract ShortCardPossessedDTO toShortCardPossessedDTO(CardPossessed cardPossessed);


    public CardDetailedDTO toCardDetailedDTO(Card source) {
        var target = new CardDetailedDTO();
        target.setSets(mapToList(source.getSets(), this::toCardSetDTO));
        target.setImages(mapToList(source.getImages(), this::toCardImageDTO));
        target.setCard(toCardDTO(source));
        target.setFavorite(cardRepository.existsByFavoritedById(authService.getConnectedUserId()));
        return target;
    }

    public CardPossessedDTO toCardPossessedDTO(CardPossessed source) {
        var target = new CardPossessedDTO();
        var cardSet = source.getCardSet();
        var card = cardSet.getCard();
        target.setCard(toCardDTO(card));
        target.setCardSet(toCardSetDTO(cardSet));
        target.setCardImage(toCardImageDTO(card.getImages().stream()
                .findAny()
                .orElse(
                        CardImage.builder()
                                .url(RouteUtils.getSampleImageRoute())
                                .smallUrl(RouteUtils.getSampleImageRoute())
                                .card(card)
                                .build()
                ))
        );
        target.setNumber(source.getNumber());
        return target;
    }


    public CardPossessed toCardPossessed(CardSet set, int number) {
        var target = new CardPossessed();
        target.setCardSet(set);
        target.setNumber(number);
        target.setUser(authService.getConnectedUser());
        return target;
    }

    public IndexedCardDetailDTO toIndexedCardDetailDTO(CardDeckIndex source) {
        var target = new IndexedCardDetailDTO();
        target.setCard(toCardDetailedDTO(source.getCard()));
        target.setIndex(source.getIndex());
        return target;
    }

    public IndexedCardImageDTO toIndexedCardImageDTO(ImageIndex source) {
        var target = new IndexedCardImageDTO();
        target.setImage(toCardImageDTO(source.getImage()));
        target.setIndex(source.getIndex());
        return target;
    }
}