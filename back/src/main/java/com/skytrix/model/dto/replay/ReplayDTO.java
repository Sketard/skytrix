package com.skytrix.model.dto.replay;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ReplayDTO {
    private UUID id;
    @NotNull
    private Long player1Id;
    @NotNull
    private Long player2Id;
    @NotNull
    private ReplayMetadata metadata;
    @Valid
    private ReplayData replayData;
    private Instant createdAt;
}
