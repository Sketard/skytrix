package com.skytrix.model.dto.replay;

import jakarta.validation.constraints.NotNull;

public record CapturedResponse(
        @NotNull Object data
) {}
