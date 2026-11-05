CREATE INDEX IF NOT EXISTS platform_audit_protocol_created_idx
  ON platform_audit (created_at DESC, application_id, action, outcome)
  WHERE action LIKE 'protocol.%';
