package com.skytrix.mapper;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

import com.skytrix.model.dto.replay.ReplayDTO;
import com.skytrix.model.dto.replay.ReplayMetadata;
import com.skytrix.model.entity.Replay;

@Mapper(componentModel = "spring")
public abstract class ReplayMapper {

    @Mapping(target = "player1Id", source = "player1.id")
    @Mapping(target = "player2Id", source = "player2.id")
    @Mapping(target = "replayData", ignore = true)
    public abstract ReplayDTO toDto(Replay replay);

    public ReplayDTO toDto(Replay replay, Long authenticatedUserId) {
        var dto = toDto(replay);
        if (authenticatedUserId.equals(dto.getPlayer2Id())) {
            var meta = dto.getMetadata();
            dto.setMetadata(new ReplayMetadata(
                    meta.playerUsernames(),
                    meta.deckNames(),
                    meta.turnCount(),
                    meta.result().flip(),
                    meta.date(),
                    meta.scriptsHash(),
                    meta.ocgcoreVersion()
            ));
        }
        return dto;
    }

    @Mapping(target = "player1Id", source = "player1.id")
    @Mapping(target = "player2Id", source = "player2.id")
    public abstract ReplayDTO toDetailDto(Replay replay);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "player1", ignore = true)
    @Mapping(target = "player2", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    public abstract Replay toEntity(ReplayDTO dto);
}
