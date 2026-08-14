package com.rlsg.clm_mvp1.user.controller;

import com.rlsg.clm_mvp1.user.dto.UserCreateRequest;
import com.rlsg.clm_mvp1.user.dto.UserResponse;
import com.rlsg.clm_mvp1.user.dto.UserUpdateRequest;
import com.rlsg.clm_mvp1.user.service.UserService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
@Tag(
        name = "User Management",
        description = "APIs for managing application users"
)
public class UserController {

    private final UserService userService;

    /**
     * Create a new user.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create user")
    public UserResponse create(
            @Valid
            @RequestBody
            UserCreateRequest request
    ) {

        return userService.create(request);
    }

    /**
     * Get user by ID.
     */
    @GetMapping("/{id}")
    @Operation(summary = "Get user by ID")
    public UserResponse getById(
            @PathVariable UUID id
    ) {

        return userService.getById(id);
    }

    /**
     * Get all users for a tenant.
     */
    @GetMapping
    @Operation(summary = "Get users by tenant")
    public Page<UserResponse> getAll(

            @RequestParam UUID tenantId,

            @RequestParam(
                    defaultValue = "0"
            )
            int page,

            @RequestParam(
                    defaultValue = "20"
            )
            int size
    ) {

        Pageable pageable = PageRequest.of(
                page,
                size,
                Sort.by("name").ascending()
        );

        return userService.getAll(
                tenantId,
                pageable
        );
    }

    /**
     * Update an existing user.
     */
    @PatchMapping("/{id}")
    @Operation(summary = "Update user")
    public UserResponse update(
            @PathVariable UUID id,

            @Valid
            @RequestBody
            UserUpdateRequest request
    ) {

        return userService.update(
                id,
                request
        );
    }

    /**
     * Deactivate a user.
     */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Deactivate user")
    public void deactivate(
            @PathVariable UUID id
    ) {

        userService.deactivate(id);
    }
}