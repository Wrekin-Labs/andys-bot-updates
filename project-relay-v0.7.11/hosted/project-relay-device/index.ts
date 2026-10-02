
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const ACCOUNT_URL = Deno.env.get("PROJECT_RELAY_ACCOUNT_URL") ?? (supabaseUrl + "/functions/v1/project-relay-account");
function backendKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch {}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const db = createClient(supabaseUrl, backendKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALLOWED = new Set([
  "commandport_browser_scroll_state",
  "commandport_process_details",
  "commandport_service",
  "commandport_prepare_service",
  "commandport_list_services",
  "commandport_list_process_details",
  "commandport_owner_power",
  "commandport_owner_service",
  "commandport_owner_update",
  "commandport_owner_run_command",
  "commandport_owner_approve",
  "commandport_hash_file",
  "commandport_read_url",
  "commandport_get_runtime_config",
  "commandport_owner_read_multiple_files",
  "commandport_owner_preview_text_replace",
  "commandport_owner_apply_text_replace",
  "commandport_owner_rollback_text_edit",
  "commandport_owner_read_document",
  "commandport_owner_search_document",
  "commandport_owner_recent_tool_calls",
  "commandport_owner_runtime_config",
  "commandport_owner_terminal_start",
  "commandport_owner_terminal_list",
  "commandport_owner_terminal_read",
  "commandport_owner_terminal_write",
  "commandport_owner_terminal_stop",
  "commandport_owner_fs_mkdir",
  "commandport_owner_fs_copy",
  "commandport_owner_fs_move",
  "commandport_owner_fs_delete",
  "commandport_owner_process_start",
  "commandport_owner_process_terminate",
  "commandport_owner_service_action",
  "commandport_owner_software_list",
  "commandport_owner_software_search",
  "commandport_owner_software_install",
  "commandport_owner_software_uninstall",
  "commandport_owner_software_upgrade",
  "commandport_owner_ui_find_control",
  "commandport_owner_ui_click_control",
  "commandport_owner_self_update",
  "supervised_list_apps",
  "supervised_app_status",
  "supervised_owner_start",
  "supervised_owner_restart",
  "commandport_find_target",
  "commandport_prepare_click_target",
  "commandport_click_target",

  "commandport_prepare_launch_app","commandport_launch_app",
  "commandport_prepare_scroll","commandport_scroll",
  "commandport_prepare_switch_tab","commandport_switch_tab",
  "list_devices","get_device_status","list_serial_ports",
  "prepare_serial_read","read_serial",
  "prepare_scan_preview","scan_preview",
  "prepare_document_print","start_document_print",
  "pending_approvals",
  "list_bridges","get_bridge","plan_bridge_action","execute_bridge_read",
  "commandport_get_file_info","commandport_list_directory","commandport_read_text_file",
  "commandport_search_files","commandport_search_text",
  "commandport_list_processes","commandport_list_windows",
  "commandport_open_url","commandport_focus_window",
  "commandport_prepare_click","commandport_click",
  "commandport_prepare_type_text","commandport_type_text",
  "commandport_prepare_write_file","commandport_write_file",
  "commandport_prepare_run_command","commandport_run_command",
  "commandport_owner_write_csv",
  "commandport_owner_write_xlsx",
  "commandport_owner_update_xlsx_cells",
  "commandport_owner_write_docx",
  "commandport_owner_write_pdf",
  "commandport_owner_rollback_document",
  "commandport_owner_sandbox_status",
  "commandport_owner_sandbox_run",
  "commandport_owner_read_image",
  "commandport_owner_write_json",
  "commandport_owner_replace_docx_text",
  "commandport_owner_pdf_delete_pages",
  "commandport_owner_pdf_insert_pdf",
  "commandport_owner_ssh_start",
  "commandport_owner_zip_list",
  "commandport_owner_zip_create",
  "commandport_owner_zip_extract",
  "commandport_owner_preview_text_transaction",
  "commandport_owner_apply_text_transaction",
  "commandport_owner_rollback_text_transaction",
  "commandport_owner_search_content",
  "commandport_owner_scheduled_tasks_list",
  "commandport_owner_scheduled_task_action",
  "commandport_capability_report",
  "commandport_health_report",
  "commandport_owner_system_snapshot",
  "commandport_owner_network_summary",
  "commandport_owner_event_log_query",
  "commandport_owner_search_start",
  "commandport_owner_search_read",
  "commandport_owner_search_list",
  "commandport_owner_search_stop",
  "commandport_owner_usage_stats",
  "commandport_owner_read_file_lines",
  "commandport_ping",
  "commandport_owner_power_action",
  "commandport_owner_write_text_file",
  "commandport_owner_update_xlsx_range",
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function pairingCode() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => PAIR_ALPHABET[b % PAIR_ALPHABET.length]);
  return chars.slice(0, 5).join("") + "-" + chars.slice(5).join("");
}
function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

async function authenticate(req: Request) {
  const deviceId = (req.headers.get("x-relay-device-id") ?? "").trim();
  const token = bearer(req);
  if (!deviceId || !token) return null;
  const tokenHash = await sha256(token);
  const { data, error } = await db
    .from("project_relay_devices")
    .select("id,name,enabled")
    .eq("id", deviceId)
    .eq("token_hash", tokenHash)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const device = await authenticate(req);
    if (!device) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json();
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "heartbeat") {
      const info = typeof body.info === "object" && body.info ? body.info : {};
      const { error } = await db
        .from("project_relay_devices")
        .update({ last_seen: now, info })
        .eq("id", device.id);
      if (error) throw error;
      return json({ ok: true, device: device.name });
    }

    if (action === "pairing_code") {
      const code = pairingCode();
      const codeHash = await sha256(normalizePairingCode(code));
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

      const { error: clearError } = await db
        .from("project_relay_pairing_codes")
        .delete()
        .eq("device_id", device.id)
        .is("used_at", null);
      if (clearError) throw clearError;

      const { error: codeError } = await db
        .from("project_relay_pairing_codes")
        .insert({ device_id: device.id, code_hash: codeHash, expires_at: expiresAt });
      if (codeError) throw codeError;

      await db.from("project_relay_audit").insert({
        device_id: device.id,
        event: "pairing_code_created",
        detail: { expires_at: expiresAt },
      });

      return json({
        ok: true,
        device: device.name,
        code,
        expires_at: expiresAt,
        account_url: ACCOUNT_URL,
      });
    }

    if (action === "poll") {
      await db.from("project_relay_devices")
        .update({ last_seen: now })
        .eq("id", device.id);

      await db.from("project_relay_tasks")
        .update({ status: "cancelled", error: "Task expired", finished_at: now })
        .eq("device_id", device.id)
        .eq("status", "queued")
        .lte("expires_at", now);

      const { data: task, error: findError } = await db
        .from("project_relay_tasks")
        .select("id,action,payload,created_at,expires_at")
        .eq("device_id", device.id)
        .eq("status", "queued")
        .gt("expires_at", now)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (findError) throw findError;
      if (!task) return json({ ok: true, task: null });
      if (!ALLOWED.has(task.action)) {
        await db.from("project_relay_tasks")
          .update({ status: "error", error: "Action is not allowed by Project Relay", finished_at: now })
          .eq("id", task.id);
        return json({ ok: true, task: null });
      }

      const { data: picked, error: pickError } = await db
        .from("project_relay_tasks")
        .update({ status: "running", picked_at: now })
        .eq("id", task.id)
        .eq("status", "queued")
        .select("id,action,payload")
        .maybeSingle();
      if (pickError) throw pickError;
      if (!picked) return json({ ok: true, task: null });

      await db.from("project_relay_audit").insert({
        device_id: device.id,
        task_id: picked.id,
        event: "task_picked",
        detail: { action: picked.action },
      });
      return json({ ok: true, task: picked });
    }

    if (action === "result") {
      const taskId = String(body.task_id ?? "");
      const success = Boolean(body.success);
      if (!taskId) return json({ ok: false, error: "task_id required" }, 400);

      const encoded = JSON.stringify(body.result ?? null);
      if (encoded.length > 1_500_000) {
        return json({ ok: false, error: "Result exceeds 1.5 MB limit" }, 413);
      }

      const update = success
        ? { status: "done", result: body.result ?? {}, error: null, finished_at: now }
        : {
            status: "error",
            result: body.result ?? null,
            error: String(body.error ?? "Task failed").slice(0, 4000),
            finished_at: now,
          };

      const { data: finished, error } = await db
        .from("project_relay_tasks")
        .update(update)
        .eq("id", taskId)
        .eq("device_id", device.id)
        .eq("status", "running")
        .select("id,status")
        .maybeSingle();
      if (error) throw error;
      if (!finished) return json({ ok: false, error: "Running task not found" }, 404);

      await db.from("project_relay_audit").insert({
        device_id: device.id,
        task_id: taskId,
        event: success ? "task_done" : "task_error",
        detail: success ? {} : { error: update.error },
      });
      return json({ ok: true, task: finished });
    }

    return json({ ok: false, error: "Unknown device action" }, 400);
  } catch (e) {
    console.error("project-relay-device error", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "Device relay request failed" }, 500);
  }
});
