package com.rlsg.clm_mvp1.tenant.service;

import com.rlsg.clm_mvp1.common.exception.DuplicateResourceException;
import com.rlsg.clm_mvp1.common.exception.ResourceNotFoundException;
import com.rlsg.clm_mvp1.tenant.dto.TenantCreateRequest;
import com.rlsg.clm_mvp1.tenant.dto.TenantResponse;
import com.rlsg.clm_mvp1.tenant.dto.TenantUpdateRequest;
import com.rlsg.clm_mvp1.tenant.entity.Tenant;
import com.rlsg.clm_mvp1.tenant.mapper.TenantMapper;
import com.rlsg.clm_mvp1.tenant.repository.TenantRepository;

import lombok.RequiredArgsConstructor;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional
public class TenantServiceImpl implements TenantService {

    private final TenantRepository tenantRepository;
    private final TenantMapper tenantMapper;

    @Override
    public TenantResponse create(TenantCreateRequest request) {

        if (tenantRepository.existsByCode(request.code())) {
            throw new DuplicateResourceException(
                    "Tenant code already exists: " + request.code()
            );
        }

        Tenant tenant = tenantMapper.toEntity(request);

        Tenant savedTenant = tenantRepository.save(tenant);

        return tenantMapper.toResponse(savedTenant);
    }

    @Override
    @Transactional(readOnly = true)
    public TenantResponse getById(UUID id) {

        Tenant tenant = tenantRepository.findById(id)
                .orElseThrow(() ->
                        new ResourceNotFoundException(
                                "Tenant not found: " + id
                        )
                );

        return tenantMapper.toResponse(tenant);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<TenantResponse> getAll(Pageable pageable) {

        return tenantRepository
                .findAll(pageable)
                .map(tenantMapper::toResponse);
    }

    @Override
    public TenantResponse update(
            UUID id,
            TenantUpdateRequest request
    ) {

        Tenant tenant = tenantRepository.findById(id)
                .orElseThrow(() ->
                        new ResourceNotFoundException(
                                "Tenant not found: " + id
                        )
                );

        if (request.name() != null) {
            tenant.setName(request.name());
        }

        if (request.email() != null) {
            tenant.setEmail(request.email());
        }

        if (request.mobile() != null) {
            tenant.setMobile(request.mobile());
        }

        if (request.status() != null) {
            tenant.setStatus(request.status());
        }

        if (request.active() != null) {
            tenant.setActive(request.active());
        }

        Tenant updatedTenant = tenantRepository.save(tenant);

        return tenantMapper.toResponse(updatedTenant);
    }

    @Override
    public void deactivate(UUID id) {

        Tenant tenant = tenantRepository.findById(id)
                .orElseThrow(() ->
                        new ResourceNotFoundException(
                                "Tenant not found: " + id
                        )
                );

        tenant.setActive(false);
        tenant.setStatus("INACTIVE");

        tenantRepository.save(tenant);
    }
}