package com.skytrix.requester;

import com.fasterxml.jackson.core.type.TypeReference;
import com.skytrix.model.dto.yugipro.EmbeddedDTO;
import com.skytrix.model.dto.yugipro.YugiproCardDTO;
import com.skytrix.model.entity.CardImage;
import com.skytrix.model.enums.Language;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.List;

@Service
public class YugiproRequester extends Requester {
    private static final String BASE_URI = "https://db.ygoprodeck.com/api/v7/cardinfo.php";

    public List<YugiproCardDTO> fetchAll(Language language) {
        var uri = defaultFetchAllBuilder();
        if (language != Language.EN) {
            uri.queryParam("language", language.code);
        }

        var request = createGetRequest(uri.toUriString());
        var response = sendRequest(request);
        var data = parseResponse(response, new TypeReference<EmbeddedDTO>() {
        });
        return data.getData();
    }

    public YugiproCardDTO fetchUnit(String name) {
        var uri = defaultFetchAllBuilder().queryParam("name", name);

        var request = createGetRequest(uri.toUriString());
        var response = sendRequest(request);
        var data = parseResponse(response, new TypeReference<EmbeddedDTO>() {
        });
        return data.getData().stream().findAny().orElse(null);
    }

    public byte[] fetchImage(CardImage cardImage, boolean small) {
        var url = "https://images.ygoprodeck.com/images/%s/%s.jpg".formatted((small ? "cards_small" : "cards"), cardImage.getCard().getPasscode());
        var request = createGetRequest(url);
        var response = sendRequestByteArray(request);
        return response.body();
    }

    private UriComponentsBuilder defaultFetchAllBuilder() {
        return UriComponentsBuilder.fromUriString(BASE_URI)
            .queryParam("misc", "yes")
            .queryParam("format", "genesys");
    }
}
