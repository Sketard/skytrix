package com.skytrix.utils;

import com.skytrix.controller.DocumentController;

public abstract class RouteUtils {

	public static String getSmallImageRoute(Long id) {
		return "%s/small/%s".formatted(DocumentController.DOCUMENT_ROOT_URL, id);
	}

	public static String getBigImageRoute(Long id) {
		return "%s/big/%s".formatted(DocumentController.DOCUMENT_ROOT_URL, id);
	}

	public static String getSampleImageRoute() {
		return "%s/sample".formatted(DocumentController.DOCUMENT_ROOT_URL);
	}
}
