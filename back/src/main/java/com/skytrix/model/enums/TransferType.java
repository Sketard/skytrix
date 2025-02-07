package com.skytrix.model.enums;

import com.skytrix.model.entity.Card;

public enum TransferType {
	CLASSIC {
		@Override public String getExportLine(Card card, long number) {
			var result = new StringBuilder();
			while(number-- > 0) {
				result.append(card.getPasscode()).append("\n");
			}
			return result.toString();
		}
	},
	MARKET {
		@Override public String getExportLine(Card card, long number) {
			return "%sx %s%n".formatted(number, card.getName());
		}
	};

	public abstract String getExportLine(Card card, long number);
}
