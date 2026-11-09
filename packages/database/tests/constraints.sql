-- Run only in the isolated, rolled-back schema created by the verification harness.
-- These are test fixtures, not captured observations or application seed data.
DO $$
BEGIN
  IF current_schema() IS DISTINCT FROM current_setting('netsleuth.test_schema', true)
     OR current_schema() !~ '^netsleuth_test_[0-9a-f]{32}$'
     OR current_schemas(false) <> ARRAY[current_schema(), 'pg_catalog']::name[] THEN
    RAISE EXCEPTION 'Constraint fixtures require the isolated test:db harness';
  END IF;
END $$;

-- Separate fixtures keep boundary checks independent of the scoped-read assertions below.
DO $$
DECLARE
  test_workspace uuid;
  test_user uuid;
  test_project uuid;
  test_agent uuid;
  test_event uuid;
  test_alert uuid;
  blank_value text;
  bad_address text;
  port_value integer;
  json_value jsonb;
  enum_value text;
  rejected_constraint text;
BEGIN
  INSERT INTO workspaces (name) VALUES ('payload constraint fixtures') RETURNING id INTO test_workspace;
  -- One non-space character is the minimum accepted by the storage constraint.
  INSERT INTO users (name, email, password_hash)
    VALUES ('boundary fixture', 'boundary@example.invalid', 'x') RETURNING id INTO test_user;
  INSERT INTO workspace_members (user_id, workspace_id) VALUES (test_user, test_workspace);
  INSERT INTO projects (workspace_id, name)
    VALUES (test_workspace, 'payload fixture project') RETURNING id INTO test_project;
  INSERT INTO agents (project_id, name)
    VALUES (test_project, 'payload fixture agent') RETURNING id INTO test_agent;
  INSERT INTO network_events
    (agent_id, event_id, event_type, source_ip, destination_ip, protocol, occurred_at)
    VALUES (test_agent, 'x', 'TEST', '192.0.2.1', '2001:db8::1', 'TEST', now())
    RETURNING id INTO test_event;
  INSERT INTO security_alerts
    (project_id, title, description, severity, rule_id, fingerprint, first_seen_at, last_seen_at)
    VALUES (test_project, 'boundary fixture', 'test only', 'LOW', 'test-rule', 'x', now(), now())
    RETURNING id INTO test_alert;

  FOREACH blank_value IN ARRAY ARRAY['', '   '] LOOP
    BEGIN
      UPDATE network_events SET event_id = blank_value WHERE id = test_event;
      RAISE EXCEPTION 'Blank event ID was accepted: %', quote_literal(blank_value);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'network_events_event_id_not_empty' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE security_alerts SET fingerprint = blank_value WHERE id = test_alert;
      RAISE EXCEPTION 'Blank fingerprint was accepted: %', quote_literal(blank_value);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'security_alerts_fingerprint_not_empty' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE users SET password_hash = blank_value WHERE id = test_user;
      RAISE EXCEPTION 'Blank password hash was accepted: %', quote_literal(blank_value);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'users_password_hash_not_empty' THEN RAISE; END IF;
    END;
  END LOOP;

  -- Exercise both inet columns with malformed IPv4, IPv6, and non-address text.
  FOREACH bad_address IN ARRAY ARRAY['192.0.2.256', '2001:db8::gg', 'not-an-ip'] LOOP
    BEGIN
      EXECUTE format('UPDATE network_events SET source_ip = %L WHERE id = %L', bad_address, test_event);
      RAISE EXCEPTION 'Invalid source IP was accepted: %', bad_address;
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
    BEGIN
      EXECUTE format('UPDATE network_events SET destination_ip = %L WHERE id = %L', bad_address, test_event);
      RAISE EXCEPTION 'Invalid destination IP was accepted: %', bad_address;
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
  END LOOP;

  FOREACH port_value IN ARRAY ARRAY[-1, 65536] LOOP
    BEGIN
      UPDATE network_events SET source_port = port_value WHERE id = test_event;
      RAISE EXCEPTION 'Out-of-range source port was accepted: %', port_value;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'network_events_source_port_range' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE network_events SET destination_port = port_value WHERE id = test_event;
      RAISE EXCEPTION 'Out-of-range destination port was accepted: %', port_value;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'network_events_destination_port_range' THEN RAISE; END IF;
    END;
  END LOOP;
  -- Both inclusive endpoints and absence of a port are valid in either column.
  FOREACH port_value IN ARRAY ARRAY[0, 65535, NULL]::integer[] LOOP
    UPDATE network_events SET source_port = port_value, destination_port = port_value
      WHERE id = test_event;
    IF NOT EXISTS (SELECT 1 FROM network_events WHERE id = test_event
        AND source_port IS NOT DISTINCT FROM port_value
        AND destination_port IS NOT DISTINCT FROM port_value) THEN
      RAISE EXCEPTION 'Valid port boundary was not stored: %', port_value;
    END IF;
  END LOOP;
  -- Swap families too: neither column is restricted to only IPv4 or IPv6.
  UPDATE network_events SET source_ip = '2001:db8::1', destination_ip = '192.0.2.1'
    WHERE id = test_event;

  -- JSON null is distinct from SQL NULL; every non-object JSON type must fail.
  FOREACH json_value IN ARRAY ARRAY['[]', '"text"', '42', 'true', 'null']::jsonb[] LOOP
    BEGIN
      UPDATE network_events SET metadata = json_value WHERE id = test_event;
      RAISE EXCEPTION 'Non-object metadata was accepted: %', json_value;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'network_events_metadata_object' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE security_alerts SET evidence = json_value WHERE id = test_alert;
      RAISE EXCEPTION 'Non-object evidence was accepted: %', json_value;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'security_alerts_evidence_object' THEN RAISE; END IF;
    END;
  END LOOP;
  FOREACH json_value IN ARRAY ARRAY['{}', '{"nested":{"items":[1,true,null]}}']::jsonb[] LOOP
    UPDATE network_events SET metadata = json_value WHERE id = test_event;
    UPDATE security_alerts SET evidence = json_value WHERE id = test_alert;
    IF NOT EXISTS (SELECT 1 FROM network_events WHERE id = test_event AND metadata = json_value)
       OR NOT EXISTS (SELECT 1 FROM security_alerts WHERE id = test_alert AND evidence = json_value) THEN
      RAISE EXCEPTION 'Valid JSON object was not stored: %', json_value;
    END IF;
  END LOOP;

  -- Unknown literals let the destination column enforce its type. Explicit casts
  -- would still reject bad inputs if a migration accidentally changed it to text.
  FOREACH enum_value IN ARRAY ARRAY['INVALID', ''] LOOP
    BEGIN
      EXECUTE format('UPDATE workspace_members SET role = %L WHERE user_id = %L', enum_value, test_user);
      RAISE EXCEPTION 'Invalid workspace role was accepted: %', enum_value;
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
    BEGIN
      EXECUTE format('UPDATE agents SET status = %L WHERE id = %L', enum_value, test_agent);
      RAISE EXCEPTION 'Invalid agent status was accepted: %', enum_value;
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
    BEGIN
      EXECUTE format('UPDATE security_alerts SET severity = %L WHERE id = %L', enum_value, test_alert);
      RAISE EXCEPTION 'Invalid alert severity was accepted: %', enum_value;
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
    BEGIN
      EXECUTE format('UPDATE security_alerts SET status = %L WHERE id = %L', enum_value, test_alert);
      RAISE EXCEPTION 'Invalid alert status was accepted: %', enum_value;
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
  END LOOP;
  FOREACH enum_value IN ARRAY ARRAY['OWNER', 'ADMIN', 'MEMBER'] LOOP
    EXECUTE format('UPDATE workspace_members SET role = %L WHERE user_id = %L', enum_value, test_user);
  END LOOP;
  FOREACH enum_value IN ARRAY ARRAY['ONLINE', 'OFFLINE', 'INACTIVE'] LOOP
    EXECUTE format('UPDATE agents SET status = %L WHERE id = %L', enum_value, test_agent);
  END LOOP;
  FOREACH enum_value IN ARRAY ARRAY['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] LOOP
    EXECUTE format('UPDATE security_alerts SET severity = %L WHERE id = %L', enum_value, test_alert);
  END LOOP;
  FOREACH enum_value IN ARRAY ARRAY['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] LOOP
    EXECUTE format('UPDATE security_alerts SET status = %L WHERE id = %L', enum_value, test_alert);
  END LOOP;
END $$;

DO $$
DECLARE
  workspace_a uuid;
  workspace_b uuid;
  user_a uuid;
  project_a uuid;
  project_b uuid;
  agent_a uuid;
  agent_b uuid;
BEGIN
  INSERT INTO workspaces (name) VALUES ('test workspace A') RETURNING id INTO workspace_a;
  INSERT INTO workspaces (name) VALUES ('test workspace B') RETURNING id INTO workspace_b;
  INSERT INTO users (name, email, password_hash)
    VALUES ('test user', 'test@example.invalid', '$argon2id$test-fixture-not-a-real-credential')
    RETURNING id INTO user_a;
  INSERT INTO workspace_members (user_id, workspace_id) VALUES (user_a, workspace_a);
  INSERT INTO workspace_members (user_id, workspace_id) VALUES (user_a, workspace_b);
  INSERT INTO projects (workspace_id, name) VALUES (workspace_a, 'test project A') RETURNING id INTO project_a;
  INSERT INTO projects (workspace_id, name) VALUES (workspace_b, 'test project B') RETURNING id INTO project_b;
  INSERT INTO agents (project_id, name) VALUES (project_a, 'test agent A') RETURNING id INTO agent_a;
  INSERT INTO agents (project_id, name) VALUES (project_b, 'test agent B') RETURNING id INTO agent_b;

  BEGIN
    INSERT INTO workspace_members (user_id, workspace_id) VALUES (user_a, workspace_a);
    RAISE EXCEPTION 'Duplicate membership was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO users (name, email, password_hash)
      VALUES ('duplicate test user', 'TEST@example.invalid', 'unused-test-fixture');
    RAISE EXCEPTION 'Case-insensitive email duplicate was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO network_events (agent_id, event_id, event_type, source_ip, destination_ip, protocol, occurred_at)
    VALUES (agent_a, 'test-event-1', 'TEST', '192.0.2.1', '2001:db8::1', 'ICMP', now());
  -- Different agents may use the same event identifier.
  INSERT INTO network_events (agent_id, event_id, event_type, source_ip, destination_ip, protocol, occurred_at)
    VALUES (agent_b, 'test-event-1', 'TEST', '192.0.2.2', '2001:db8::2', 'ICMP', now());
  BEGIN
    INSERT INTO network_events (agent_id, event_id, event_type, source_ip, destination_ip, protocol, occurred_at)
      VALUES (agent_a, 'test-event-1', 'TEST', '192.0.2.1', '192.0.2.2', 'TCP', now());
    RAISE EXCEPTION 'Duplicate agent event was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO network_events (agent_id, event_id, event_type, source_ip, source_port, destination_ip, protocol, occurred_at)
      VALUES (agent_a, 'test-bad-port', 'TEST', '192.0.2.1', 65536, '192.0.2.2', 'TCP', now());
    RAISE EXCEPTION 'Out-of-range port was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO agents (project_id, name) VALUES (gen_random_uuid(), 'orphan test agent');
    RAISE EXCEPTION 'Orphan agent was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO security_alerts (project_id, agent_id, title, description, severity, rule_id, fingerprint)
    VALUES (project_a, agent_a, 'test alert', 'test only', 'LOW', 'test-rule', 'same-fingerprint');
  INSERT INTO security_alerts (project_id, agent_id, title, description, severity, rule_id, fingerprint)
    VALUES (project_b, NULL, 'test project-wide alert', 'test only', 'LOW', 'test-rule', 'same-fingerprint');
  BEGIN
    INSERT INTO security_alerts (project_id, agent_id, title, description, severity, rule_id, fingerprint)
      VALUES (project_a, agent_b, 'test cross-project alert', 'test only', 'LOW', 'test-rule', 'cross-project');
    RAISE EXCEPTION 'Cross-project agent alert was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO security_alerts (project_id, title, description, severity, rule_id, fingerprint)
      VALUES (project_a, 'test duplicate alert', 'test only', 'LOW', 'test-rule', 'same-fingerprint');
    RAISE EXCEPTION 'Duplicate project fingerprint was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO security_alerts (project_id, title, description, severity, rule_id, fingerprint, first_seen_at, last_seen_at)
      VALUES (project_a, 'test invalid times', 'test only', 'LOW', 'test-rule', 'bad-times', now(), now() - interval '1 minute');
    RAISE EXCEPTION 'Reversed alert timestamps were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Equivalent join predicates used by the exported workspace/project-scoped queries.
  IF (SELECT count(*) FROM network_events e
      JOIN agents a ON a.id = e.agent_id JOIN projects p ON p.id = a.project_id
      WHERE p.workspace_id = workspace_a AND p.id = project_a) <> 1 THEN
    RAISE EXCEPTION 'Scoped event query returned the wrong events';
  END IF;
  IF EXISTS (SELECT 1 FROM network_events e
      JOIN agents a ON a.id = e.agent_id JOIN projects p ON p.id = a.project_id
      WHERE p.workspace_id = workspace_a AND p.id = project_b) THEN
    RAISE EXCEPTION 'Mismatched workspace/project scope returned events';
  END IF;

  DELETE FROM workspaces WHERE id = workspace_a;
  IF EXISTS (SELECT 1 FROM projects WHERE id = project_a)
     OR EXISTS (SELECT 1 FROM agents WHERE id = agent_a)
     OR EXISTS (SELECT 1 FROM network_events WHERE agent_id = agent_a)
     OR EXISTS (SELECT 1 FROM security_alerts WHERE project_id = project_a) THEN
    RAISE EXCEPTION 'Workspace deletion did not cascade to monitoring data';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agents WHERE id = agent_b)
     OR NOT EXISTS (SELECT 1 FROM users WHERE id = user_a) THEN
    RAISE EXCEPTION 'Workspace deletion affected another workspace or its user';
  END IF;
END $$;
