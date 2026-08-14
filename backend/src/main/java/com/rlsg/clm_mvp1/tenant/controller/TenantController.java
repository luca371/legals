package com.rlsg.clm_mvp1.tenant.controller;


import com.rlsg.clm_mvp1.tenant.dto.TenantCreateRequest;
import com.rlsg.clm_mvp1.tenant.dto.TenantResponse;
import com.rlsg.clm_mvp1.tenant.dto.TenantUpdateRequest;
import com.rlsg.clm_mvp1.tenant.service.TenantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/tenants")
@RequiredArgsConstructor
@Tag(
        name = "Tenant Management",
        description = "APIs for managing tenants"
)
public class TenantController {

    private final TenantService tenantService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(
            summary = "Create tenant"
    )
    public TenantResponse create(
            @Valid
            @RequestBody
            TenantCreateRequest request
    ) {

        return tenantService.create(request);
    }

    @GetMapping("/{id}")
    @Operation(
            summary = "Get tenant by ID"
    )
    public TenantResponse getById(
            @PathVariable UUID id
    ) {

        return tenantService.getById(id);
    }

    @GetMapping
    @Operation(
            summary = "Get all tenants"
    )
    public Page<TenantResponse> getAll(
            @PageableDefault(
                    size = 20,
                    sort = "name"
            )
            Pageable pageable
    ) {

        return tenantService.getAll(pageable);
    }

    @PatchMapping("/{id}")
    @Operation(
            summary = "Update tenant"
    )
    public TenantResponse update(
            @PathVariable UUID id,

            @Valid
            @RequestBody
            TenantUpdateRequest request
    ) {

        return tenantService.update(
                id,
                request
        );
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(
            summary = "Deactivate tenant"
    )
    public void deactivate(
            @PathVariable UUID id
    ) {

        tenantService.deactivate(id);
    }
}