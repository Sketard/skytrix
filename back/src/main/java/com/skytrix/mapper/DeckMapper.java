package com.skytrix.mapper;

import jakarta.inject.Inject;

import static com.skytrix.model.enums.DeckKeyword.EXTRA;
import static com.skytrix.model.enums.DeckKeyword.MAIN;
import static com.skytrix.model.enums.DeckKeyword.SIDE;
import static com.skytrix.model.enums.DeckKeyword.checkValidity;
import static com.skytrix.utils.CoreUtils.mapToList;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

import com.skytrix.model.dto.deck.DeckDTO;
import com.skytrix.model.dto.deck.ShortDeckDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardDeckIndex;
import com.skytrix.model.entity.CardImage;
import com.skytrix.model.entity.Deck;
import com.skytrix.model.entity.ImageIndex;
import com.skytrix.model.enums.DeckKeyword;
import com.skytrix.utils.RouteUtils;

@Mapper(componentModel = "spring")
public abstract class DeckMapper {

	@Inject
	private CardMapper cardMapper;

	public Deck toDeck(String deckName, Map<DeckKeyword, List<Card>> deckMap) {
		deckMap.forEach((key, value) -> checkValidity(value.size(), key));
		var deck = new Deck();
		deck.setName(deckName);

		var main = deckMap.get(DeckKeyword.MAIN);
		for(int i = 0; i < main.size(); i++) {
			deck.addCard(toCardDeckIndex(main.get(i), i, MAIN, deck));
		}

		var extra = deckMap.get(DeckKeyword.EXTRA);
		for(int i = 0; i < extra.size(); i++) {
			deck.addCard(toCardDeckIndex(extra.get(i), i, EXTRA, deck));
		}

		var side = deckMap.get(DeckKeyword.SIDE);
		for(int i = 0; i < side.size(); i++) {
			deck.addCard(toCardDeckIndex(side.get(i), i, SIDE, deck));
		}

		return deck;
	}

	@Mapping(target = "id", ignore = true)
	@Mapping(target = "card", source = "card")
	@Mapping(target = "index", source = "index")
	@Mapping(target = "type", source = "type")
	@Mapping(target = "deck", source = "deck")
	public abstract CardDeckIndex toCardDeckIndex(Card card, int index, DeckKeyword type, Deck deck);

	public DeckDTO toDeckDTO(Deck source) {
		var target = new DeckDTO();
		target.setId(source.getId());
		target.setImages(mapToList(source.getImages(), cardMapper::toIndexedCardImageDTO));
		target.setName(source.getName());
		target.setMainDeck(mapToList(source.getMainDeckIndexed(), cardMapper::toIndexedCardDetailDTO));
		target.setExtraDeck(mapToList(source.getExtraDeckIndexed(), cardMapper::toIndexedCardDetailDTO));
		target.setSideDeck(mapToList(source.getSideDeckIndexed(), cardMapper::toIndexedCardDetailDTO));
		return target;
	}

	public ShortDeckDTO toShortDeckDTO(Deck source) {
		var target = new ShortDeckDTO();
		target.setId(source.getId());
		target.setName(source.getName());
		var urls = source.getImages().stream()
				.map(image -> RouteUtils.getSmallImageRoute(image.getImage().getId()))
				.limit(3)
				.collect(Collectors.toList());
		while (urls.size() < 3) {
			urls.add(RouteUtils.getSampleImageRoute());
		}
		target.setUrls(urls);
		return target;
	}

	@Mapping(target = "image", source = "source")
	@Mapping(target = "index", source = "index")
	@Mapping(target = "deck", source = "deck")
	@Mapping(target = "id", ignore = true)
	public abstract ImageIndex toImageIndex(CardImage source, int index, Deck deck);
}
