ALTER TABLE "mcp_servers"
    ADD COLUMN "transport" VARCHAR(32) NOT NULL DEFAULT 'streamable_http',
    ALTER COLUMN "url" DROP NOT NULL,
    ADD COLUMN "command" VARCHAR(512),
    ADD COLUMN "args_json" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "encrypted_environment" TEXT,
    ADD COLUMN "environment_keys_json" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "mcp_servers"
    ADD CONSTRAINT "mcp_servers_transport_check"
        CHECK ("transport" IN ('streamable_http', 'stdio')),
    ADD CONSTRAINT "mcp_servers_args_json_array_check"
        CHECK (jsonb_typeof("args_json") = 'array'),
    ADD CONSTRAINT "mcp_servers_environment_keys_json_array_check"
        CHECK (jsonb_typeof("environment_keys_json") = 'array'),
    ADD CONSTRAINT "mcp_servers_transport_fields_check"
        CHECK (
            (
                "transport" = 'streamable_http'
                AND "url" IS NOT NULL
                AND "command" IS NULL
                AND "args_json" = '[]'::jsonb
                AND "encrypted_environment" IS NULL
                AND "environment_keys_json" = '[]'::jsonb
            )
            OR
            (
                "transport" = 'stdio'
                AND "url" IS NULL
                AND "command" IS NOT NULL
                AND length(btrim("command")) > 0
                AND "auth_type" = 'none'
                AND "api_key_header" IS NULL
                AND "encrypted_credential" IS NULL
                AND "insecure_http_acknowledged" = false
                AND (
                    (
                        "environment_keys_json" = '[]'::jsonb
                        AND "encrypted_environment" IS NULL
                    )
                    OR
                    (
                        "environment_keys_json" <> '[]'::jsonb
                        AND "encrypted_environment" IS NOT NULL
                        AND "encryption_key_id" IS NOT NULL
                    )
                )
            )
        );
