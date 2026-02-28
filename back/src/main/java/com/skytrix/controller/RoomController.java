package com.skytrix.controller;

import java.util.List;

import jakarta.inject.Inject;
import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.model.dto.room.CreateRoomDTO;
import com.skytrix.model.dto.room.JoinRoomDTO;
import com.skytrix.model.dto.room.RoomDTO;
import com.skytrix.security.AuthService;
import com.skytrix.service.RoomService;

@RestController
@RequestMapping("/rooms")
public class RoomController {

    @Inject
    private RoomService roomService;

    @Inject
    private AuthService authService;

    @PostMapping
    @ResponseStatus(code = HttpStatus.CREATED)
    public RoomDTO createRoom(@RequestBody @Valid CreateRoomDTO dto) {
        return roomService.createRoom(dto);
    }

    @PostMapping("/{roomCode}/join")
    @ResponseStatus(code = HttpStatus.OK)
    public RoomDTO joinRoom(@PathVariable("roomCode") String roomCode, @RequestBody @Valid JoinRoomDTO dto) {
        return roomService.joinRoom(roomCode, dto);
    }

    @GetMapping
    @ResponseStatus(code = HttpStatus.OK)
    public List<RoomDTO> listOpenRooms() {
        return roomService.listOpenRooms();
    }

    @GetMapping("/{roomCode}")
    @ResponseStatus(code = HttpStatus.OK)
    public RoomDTO getRoom(@PathVariable("roomCode") String roomCode) {
        var userId = authService.getConnectedUserId();
        return roomService.getRoom(roomCode, userId);
    }

    @PostMapping("/{id}/end")
    @ResponseStatus(code = HttpStatus.OK)
    public void endRoom(@PathVariable("id") Long id) {
        roomService.endRoom(id);
    }
}
