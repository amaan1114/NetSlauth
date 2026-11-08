-- Run only in the isolated, rolled-back schema created by the verification harness.
-- These are test fixtures, not captured observations or application seed data.
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
