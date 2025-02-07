package com.skytrix.utils;

import org.springframework.core.io.ClassPathResource;

import com.skytrix.exception.InternalServerError;

public abstract class FileUtils {

	public static byte[] getSampleCardFile() {
		try {
			return new ClassPathResource("images/card_back.jpg").getContentAsByteArray();
		} catch(Exception e) {
			throw new InternalServerError(e.getMessage());
		}
	}
}
