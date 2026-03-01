package com.skytrix.mapper;

import jakarta.inject.Inject;

import org.mapstruct.Mapper;

import com.skytrix.model.dto.room.RoomDTO;
import com.skytrix.model.entity.Room;

@Mapper(componentModel = "spring")
public abstract class RoomMapper {

    @Inject
    private UserMapper userMapper;

    public RoomDTO toRoomDTO(Room room, Long requestingUserId) {
        var dto = new RoomDTO();
        dto.setId(room.getId());
        dto.setRoomCode(room.getRoomCode());
        dto.setStatus(room.getStatus());
        dto.setPlayer1(userMapper.toShortUserDTO(room.getPlayer1()));
        dto.setPlayer2(room.getPlayer2() != null ? userMapper.toShortUserDTO(room.getPlayer2()) : null);
        dto.setDuelId(room.getDuelServerId());
        dto.setCreatedAt(room.getCreatedAt());

        if (requestingUserId != null) {
            if (room.getPlayer1() != null && requestingUserId.equals(room.getPlayer1().getId())) {
                dto.setWsToken(room.getWsToken1());
                dto.setDecklistId(room.getPlayer1DecklistId());
            } else if (room.getPlayer2() != null && requestingUserId.equals(room.getPlayer2().getId())) {
                dto.setWsToken(room.getWsToken2());
                dto.setDecklistId(room.getPlayer2DecklistId());
            }
        }

        return dto;
    }
}
