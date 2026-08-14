package com.rlsg.clm_mvp1.user.service;

import com.rlsg.clm_mvp1.user.dto.UserCreateRequest;
import com.rlsg.clm_mvp1.user.dto.UserResponse;
import com.rlsg.clm_mvp1.user.dto.UserUpdateRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

public interface UserService {

    UserResponse create(
            UserCreateRequest request
    );

    UserResponse getById(
            UUID id
    );

    Page<UserResponse> getAll(
            UUID tenantId,
            Pageable pageable
    );

    UserResponse update(
            UUID id,
            UserUpdateRequest request
    );

    void deactivate(
            UUID id
    );
}