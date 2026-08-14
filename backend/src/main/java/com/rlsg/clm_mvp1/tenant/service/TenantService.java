package com.rlsg.clm_mvp1.tenant.service;

import com.rlsg.clm_mvp1.tenant.dto.TenantCreateRequest;
import com.rlsg.clm_mvp1.tenant.dto.TenantResponse;
import com.rlsg.clm_mvp1.tenant.dto.TenantUpdateRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

public interface TenantService {

    TenantResponse create(
            TenantCreateRequest request
    );

    TenantResponse getById(
            UUID id
    );

    Page<TenantResponse> getAll(
            Pageable pageable
    );

    TenantResponse update(
            UUID id,
            TenantUpdateRequest request
    );

    void deactivate(
            UUID id
    );
}