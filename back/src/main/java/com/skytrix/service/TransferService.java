package com.skytrix.service;

import jakarta.inject.Inject;

import static com.skytrix.model.enums.DeckKeyword.EXTRA;
import static com.skytrix.model.enums.DeckKeyword.MAIN;
import static com.skytrix.model.enums.DeckKeyword.SIDE;
import static com.skytrix.utils.CoreUtils.countMap;
import static java.util.function.Function.identity;
import static java.util.stream.Collectors.toMap;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.springframework.stereotype.Service;

import com.skytrix.exception.InternalServerError;
import com.skytrix.mapper.DeckMapper;
import com.skytrix.model.dto.deck.DeckDTO;
import com.skytrix.model.dto.deck.ExportDeckDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.Deck;
import com.skytrix.model.enums.DeckKeyword;
import com.skytrix.model.enums.TransferType;
import com.skytrix.repository.CardRepository;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class TransferService {
	@Inject
	private CardRepository cardRepository;

	@Inject
	private DeckMapper deckMapper;


	public DeckDTO importDeckFromFile(byte[] content) {
		return deckMapper.toDeckDTO(importDeck(content));
	}

	private Deck importDeck(byte[] content) {
		var deckMap = new EnumMap<DeckKeyword, List<Card>>(DeckKeyword.class);
		Arrays.stream(DeckKeyword.values()).forEach(keyword -> deckMap.put(keyword, new ArrayList<>()));

		try (BufferedReader br = new BufferedReader(new InputStreamReader(new ByteArrayInputStream(content), StandardCharsets.UTF_8))) {
			var deckName = br.readLine().substring(1);
			var context = MAIN;
			String line;
			while((line = br.readLine()) !=  null) {
				switch(DeckKeyword.getDeckKeyword(line)) {
					case MAIN -> context = MAIN;
					case SIDE -> context = SIDE;
					case EXTRA -> context = EXTRA;
					case DEFAULT -> {
						var card = cardRepository.findByPasscode(Long.parseLong(line));
						if (card != null) {
							deckMap.get(context).add(card);
						} else {
							log.warn("No card found with passcode {}", line);
						}
					}
				}
			}
			return deckMapper.toDeck(deckName, deckMap);
		} catch(IOException e) {
			throw new InternalServerError("An error occured while importing deck");
		}
	}

	public byte[] exportDeck(ExportDeckDTO deckDTO) {
		StringBuilder exportBuilder = new StringBuilder();

		// Ajout du header
		exportBuilder.append("#%s%n".formatted(deckDTO.getName()));

		var main = countMap(deckDTO.getMainIds());
		var extra = countMap(deckDTO.getExtraIds());
		var side = countMap(deckDTO.getSideIds());
		var allIds = Stream.of(main.keySet(), extra.keySet(), side.keySet()).flatMap(Collection::stream).toList();
		var cardsMap = cardRepository.findAllByIdIn(allIds).stream().collect(toMap(Card::getId, identity()));
		var exportType = deckDTO.getTransferType();

		// Section MAIN
		exportBuilder.append("#main\n");
		buildZone(main, cardsMap, exportBuilder, exportType);

		// Section EXTRA
		exportBuilder.append("#extra\n");
		buildZone(extra, cardsMap, exportBuilder, exportType);

		// Section SIDE
		exportBuilder.append("!side\n");
		buildZone(side, cardsMap, exportBuilder, exportType);

		// Conversion en byte[]
		return exportBuilder.toString().getBytes(StandardCharsets.UTF_8);
	}

	private void buildZone(Map<Long, Long> zoneSpecificity, Map<Long, Card> cardsMap, StringBuilder builder, TransferType exportType) {
		zoneSpecificity.forEach((key, value) -> {
			var card = cardsMap.get(key);
			builder.append(exportType.getExportLine(card, value));
		});
	}
}
