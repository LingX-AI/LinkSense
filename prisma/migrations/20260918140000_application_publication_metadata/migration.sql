-- Preserve all existing definition fields. Pre-snapshot presentation is retained
-- from the application at upgrade time; future releases freeze it independently.
UPDATE application_versions v SET definition_json = jsonb_build_object(
  'description', a.description, 'iconPreset', a.icon_preset, 'iconObjectKey', a.icon_object_key
) || v.definition_json
FROM applications a WHERE v.application_id = a.id AND v.assets_ready = true;
