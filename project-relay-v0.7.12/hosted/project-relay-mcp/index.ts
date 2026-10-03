
import { createClient } from "npm:@supabase/supabase-js@2";
// Parsed in CI so hosted MCP syntax errors cannot reach production unnoticed.

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const RESOURCE = Deno.env.get("PROJECT_RELAY_MCP_RESOURCE") ?? "https://project-relay-mcp-gateway.onrender.com/mcp";
const AUTH_SERVER = Deno.env.get("PROJECT_RELAY_AUTH_SERVER") ?? "https://project-relay-mcp-gateway.onrender.com";
const OAUTH_UI = Deno.env.get("PROJECT_RELAY_OAUTH_UI") ?? "https://project-relay-mcp-gateway.onrender.com/account";
const RESOURCE_METADATA = RESOURCE + "/.well-known/oauth-protected-resource";
const REQUIRED_SCOPE = "relay:inspect";
const SECURITY_SCHEMES = [{ type: "oauth2", scopes: [REQUIRED_SCOPE] }];

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

const WHATSAPP_GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v26.0";

function whatsappAccessToken() {
  return Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
}

const ACTIONS = new Set([
  "commandport_browser_scroll_state",
  "commandport_process_details",
  "commandport_service",
  "commandport_prepare_service",
  "commandport_list_services",
  "commandport_list_process_details",
  "supervised_list_apps",
  "supervised_app_status",
  "supervised_owner_start",
  "supervised_owner_restart",
  "commandport_owner_power",
  "commandport_owner_service",
  "commandport_owner_update",
  "commandport_owner_run_command",
  "commandport_owner_approve",
  "supervised_list_apps",
  "supervised_app_status",
  "supervised_owner_start",
  "supervised_owner_restart",
  "commandport_prepare_launch_app",
  "commandport_launch_app",
  "commandport_find_target",
  "commandport_prepare_click_target",
  "commandport_click_target",

  "commandport_prepare_scroll",
  "commandport_scroll",
  "commandport_prepare_switch_tab",
  "commandport_switch_tab",

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

const PUBLIC_TOOLS = new Set([
  "commandport_browser_scroll_state",
  "supervised_list_apps",
  "supervised_app_status",
  "supervised_owner_start",
  "supervised_owner_restart",
  "commandport_prepare_launch_app",
  "commandport_launch_app",
  "get_workstation_capabilities",
  "commandport_list_processes",
  "commandport_service",
  "commandport_prepare_service",
  "commandport_list_services",
  "commandport_list_process_details",
  "pending_approvals",
  "commandport_find_target",
  "commandport_prepare_click_target",
  "commandport_click_target",
  "commandport_prepare_scroll",
  "commandport_scroll",
  "commandport_prepare_switch_tab",
  "commandport_switch_tab",
  "get_profile",
  "get_relay_status",
  "whatsapp_status",
  "whatsapp_link_number",
  "whatsapp_subscription_status",
  "whatsapp_subscribe_waba",
  "whatsapp_recent_messages",
  "whatsapp_search_messages",
  "whatsapp_get_conversation",
  "whatsapp_prepare_send",
  "whatsapp_send_prepared",
  "whatsapp_cancel_prepared",
  "list_workstations",
  "list_devices",
  "get_device_status",
  "list_serial_ports",
  "list_bridges",
  "get_bridge",
  "plan_bridge_action",
  "execute_bridge_read",
  "commandport_get_file_info",
  "commandport_list_directory",
  "commandport_search_files",
  "commandport_list_windows",
  "commandport_open_url",
  "commandport_focus_window",
  "commandport_prepare_click",
  "commandport_click",
  "commandport_prepare_type_text",
  "commandport_type_text",
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
  "commandport_read_text_file",
  "commandport_search_text",
  "commandport_prepare_write_file",
  "commandport_write_file",
  "commandport_prepare_run_command",
  "commandport_run_command",
]);

const OWNER_CONTROL_TOOLS = new Set([
  "commandport_launch_app",
  "supervised_owner_start",
  "supervised_owner_restart",
  "commandport_click_target",
  "commandport_click",
  "commandport_type_text",
  "commandport_scroll",
  "commandport_switch_tab",
  "commandport_owner_run_command",
  "commandport_owner_approve",
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
  "commandport_owner_system_snapshot",
  "commandport_owner_network_summary",
  "commandport_owner_event_log_query",
  "commandport_owner_search_start",
  "commandport_owner_search_read",
  "commandport_owner_search_list",
  "commandport_owner_search_stop",
  "commandport_owner_usage_stats",
  "commandport_owner_read_file_lines",
  "commandport_owner_power_action",
  "commandport_owner_write_text_file",
  "commandport_owner_update_xlsx_range",
  "commandport_read_text_file",
  "commandport_search_text",
  "commandport_prepare_write_file",
  "commandport_write_file",
  "commandport_prepare_run_command",
  "commandport_run_command",
  "commandport_service",
  "commandport_prepare_service",
  "commandport_list_services",
  "commandport_list_process_details",
]);

const PURE_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const INSPECTION = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const CONTROL = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Cancellation ends unfinished work and cannot resume that same session.
const SEARCH_CANCELLATION = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const OPEN_WORLD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const OPEN_WORLD_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const EXTERNAL_SEND = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const EXTERNAL_CONFIG = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const DESKTOP_MUTATION = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const PHYSICAL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

const relayDeviceProp = { relay_device: { type: "string", description: "Optional Relay workstation name or UUID." } };
const PROFILE_OUTPUT_SCHEMA = {
  type:"object",
  properties:{
    id:{type:"string",description:"Stable identifier for the authenticated Project Relay profile."},
    name:{type:"string"},
    email:{type:"string"},
    nickname:{type:"string"},
  },
  required:["id"],
  additionalProperties:false,
};

const tools = [
  { name:"commandport_owner_run_command", description:"Owner Full Control: run one bounded PowerShell command on an explicitly owner-linked workstation. Output and timeout remain bounded by the local adapter.", inputSchema:{type:"object",properties:{...relayDeviceProp,command:{type:"string",maxLength:12000},cwd:{type:"string"},timeout_seconds:{type:"integer",default:60,minimum:1,maximum:300}},required:["command"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_approve", description:"Owner Full Control: remotely approve one existing unexpired exact workstation approval. Does not execute the pending action; the original action must still consume that approval once.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string",minLength:1,maxLength:128}},required:["approval_id"]}, annotations:DESKTOP_MUTATION },
  { name:"supervised_list_apps", description:"List locally registered supervised applications without private launch arguments.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:PURE_READ },
  { name:"supervised_app_status", description:"Inspect exact-process status and duplicate count for one locally registered supervised application.", inputSchema:{type:"object",properties:{...relayDeviceProp,name:{type:"string",minLength:1,maxLength:80}},required:["name"]}, annotations:PURE_READ },
  { name:"supervised_owner_start", description:"Owner Full Control: start one locally registered supervised application only when no matching instance is running.", inputSchema:{type:"object",properties:{...relayDeviceProp,name:{type:"string",minLength:1,maxLength:80}},required:["name"]}, annotations:DESKTOP_MUTATION },
  { name:"supervised_owner_restart", description:"Owner Full Control: restart one locally registered supervised application by exact executable identity.", inputSchema:{type:"object",properties:{...relayDeviceProp,name:{type:"string",minLength:1,maxLength:80}},required:["name"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_browser_scroll_state", description:"Inspect the active browser's vertical scrollability and position without page text, form values, URLs or pixels. Unknown means the browser lacks a usable scroll provider.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"commandport_prepare_launch_app", description:"Prepare exact local approval to open Notepad, Calculator or Relay. No paths, documents or custom arguments are accepted.", inputSchema:{type:"object",properties:{...relayDeviceProp,app:{type:"string",enum:["notepad","calculator","relay"]}},required:["app"]}, annotations:CONTROL },
  { name:"commandport_launch_app", description:"Launch the exact allowlisted app approved locally. A process start does not confirm a ready window; inspect windows afterwards. Never retry automatically after a timeout.", inputSchema:{type:"object",properties:{...relayDeviceProp,app:{type:"string",enum:["notepad","calculator","relay"]},approval_id:{type:"string"}},required:["app","approval_id"]}, annotations:DESKTOP_MUTATION },
  { name:"get_workstation_capabilities", description:"Inspect the linked workstation's last advertised actions and which are published by this server. This does not execute them or verify this chat's cached tool list.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:PURE_READ },
  { name:"commandport_find_target", description:"Find exactly one visible browser button or link by its public label. Does not read input values or return page text.", inputSchema:{type:"object",properties:{...relayDeviceProp,label:{type:"string",minLength:1,maxLength:160},role:{type:"string",enum:["button","link"],default:"button"}},required:["label"]}, annotations:INSPECTION },
  { name:"commandport_prepare_click_target", description:"Prepare local approval for an exact-label browser button or link click. Never supply secrets as labels.", inputSchema:{type:"object",properties:{...relayDeviceProp,label:{type:"string",minLength:1,maxLength:160},role:{type:"string",enum:["button","link"],default:"button"}},required:["label"]}, annotations:CONTROL },
  { name:"commandport_click_target", description:"Click the exact locally approved browser control after checking current identity, geometry and occlusion.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},label:{type:"string",minLength:1,maxLength:160},role:{type:"string",enum:["button","link"],default:"button"}},required:["approval_id","label"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_prepare_scroll", description:"Prepare a local approval for bounded scroll in the same active window.", inputSchema:{type:"object",properties:{...relayDeviceProp,ticks:{type:"integer",minimum:-10,maximum:10}},required:["ticks"]}, annotations:CONTROL },
  { name:"commandport_scroll", description:"Execute a locally approved bounded scroll in the same active window.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},ticks:{type:"integer",minimum:-10,maximum:10}},required:["approval_id","ticks"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_prepare_switch_tab", description:"Prepare a local approval for tab switch in the same active browser window.", inputSchema:{type:"object",properties:{...relayDeviceProp,direction:{type:"string",enum:["next","previous"]}},required:["direction"]}, annotations:CONTROL },
  { name:"commandport_switch_tab", description:"Execute a locally approved tab switch in the same active browser window.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},direction:{type:"string",enum:["next","previous"]}},required:["approval_id","direction"]}, annotations:DESKTOP_MUTATION },
  { name:"get_profile", title:"Get Project Relay profile", description:"Return the Project Relay profile represented by the authenticated credentials.", inputSchema:{type:"object",properties:{},additionalProperties:false}, outputSchema:PROFILE_OUTPUT_SCHEMA, annotations:PURE_READ, _meta:{"openai/profile":true} },
  { name:"get_relay_status", title:"Check Project Relay status", description:"Report the hosted ChatGPT Relay version, published tool count, latest stable release and linked workstation versions so version drift is easy to detect.", inputSchema:{type:"object",properties:{},additionalProperties:false}, annotations:PURE_READ },
  { name:"whatsapp_status", title:"Check WhatsApp Relay status", description:"Show the WhatsApp Business numbers linked to this Project Relay account and whether the required server-side WhatsApp configuration is present. Secret values are never returned.", inputSchema:{type:"object",properties:{},additionalProperties:false}, annotations:PURE_READ },
  { name:"whatsapp_link_number", title:"Link WhatsApp Business number", description:"Validate a WhatsApp Cloud API phone-number ID using the configured Meta credential, then link that number to the authenticated Project Relay account. This changes only Relay configuration and does not send a message.", inputSchema:{type:"object",properties:{phone_number_id:{type:"string",minLength:3,maxLength:64},business_account_id:{type:"string",maxLength:64},label:{type:"string",maxLength:120},coexistence:{type:"boolean",default:false}},required:["phone_number_id"],additionalProperties:false}, annotations:CONTROL },
  { name:"whatsapp_subscription_status", title:"Check WhatsApp WABA subscription", description:"Read whether the configured Meta app is subscribed to the linked WhatsApp Business Account webhooks. Requires a stored WABA ID and does not change Meta configuration.", inputSchema:{type:"object",properties:{account_id:{type:"string",format:"uuid"}},additionalProperties:false}, annotations:OPEN_WORLD_READ },
  { name:"whatsapp_subscribe_waba", title:"Subscribe WhatsApp WABA webhooks", description:"Subscribe the configured Meta app to the linked WhatsApp Business Account so webhook events are delivered for its phone numbers. This changes Meta configuration and requires the whatsapp_business_management permission.", inputSchema:{type:"object",properties:{account_id:{type:"string",format:"uuid"}},additionalProperties:false}, annotations:EXTERNAL_CONFIG },
  { name:"whatsapp_recent_messages", title:"Read recent WhatsApp messages", description:"Read recent inbound and outbound WhatsApp messages stored for a linked business number. This is read-only.", inputSchema:{type:"object",properties:{account_id:{type:"string",format:"uuid"},limit:{type:"integer",default:30,minimum:1,maximum:100}},additionalProperties:false}, annotations:PURE_READ },
  { name:"whatsapp_search_messages", title:"Search WhatsApp messages", description:"Search recent stored WhatsApp messages for text, phone number, type, direction, or status within the authenticated user's linked business account.", inputSchema:{type:"object",properties:{account_id:{type:"string",format:"uuid"},query:{type:"string",minLength:1,maxLength:200},limit:{type:"integer",default:30,minimum:1,maximum:100}},required:["query"],additionalProperties:false}, annotations:PURE_READ },
  { name:"whatsapp_get_conversation", title:"Read WhatsApp conversation", description:"Read the recent stored conversation with one exact WhatsApp phone number. This is read-only and does not contact WhatsApp.", inputSchema:{type:"object",properties:{account_id:{type:"string",format:"uuid"},contact:{type:"string",minLength:6,maxLength:32},limit:{type:"integer",default:50,minimum:1,maximum:200}},required:["contact"],additionalProperties:false}, annotations:PURE_READ },
  { name:"whatsapp_prepare_send", title:"Prepare WhatsApp message", description:"Create a short-lived preview of an exact WhatsApp text message for later confirmation. This does not send anything to WhatsApp.", inputSchema:{type:"object",properties:{account_id:{type:"string",format:"uuid"},to:{type:"string",minLength:6,maxLength:32},body:{type:"string",minLength:1,maxLength:4096},reply_to_wamid:{type:"string",maxLength:256}},required:["to","body"],additionalProperties:false}, annotations:CONTROL },
  { name:"whatsapp_send_prepared", title:"Send prepared WhatsApp message", description:"Send exactly one previously prepared WhatsApp text message to the external recipient. This is an irreversible outbound communication and must be confirmed before use. Meta may reject free-form messages outside the permitted customer-service window.", inputSchema:{type:"object",properties:{request_id:{type:"string",format:"uuid"}},required:["request_id"],additionalProperties:false}, annotations:EXTERNAL_SEND },
  { name:"whatsapp_cancel_prepared", title:"Cancel prepared WhatsApp message", description:"Cancel one pending prepared WhatsApp message before it is sent. This never contacts the recipient.", inputSchema:{type:"object",properties:{request_id:{type:"string",format:"uuid"}},required:["request_id"],additionalProperties:false}, annotations:CONTROL },
  { name:"list_workstations", description:"List enrolled Project Relay workstations and current online state.", inputSchema:{type:"object",properties:{}}, annotations:PURE_READ },
  { name:"list_devices", description:"List the read-only hardware inventory on a paired Project Relay workstation.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"get_device_status", description:"Read current metadata for one discovered hardware device.", inputSchema:{type:"object",properties:{...relayDeviceProp,device_id:{type:"string"}},required:["device_id"]}, annotations:INSPECTION },
  { name:"list_serial_ports", description:"List serial/COM devices without opening them.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"prepare_serial_read", description:"Create an exact local approval request for a bounded serial read; does not open the port.", inputSchema:{type:"object",properties:{...relayDeviceProp,device_id:{type:"string"},seconds:{type:"number",default:2},baudrate:{type:"integer",default:115200},max_bytes:{type:"integer",default:4096}},required:["device_id"]}, annotations:CONTROL },
  { name:"read_serial", description:"Perform a bounded serial read only after the matching approval was granted locally.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},device_id:{type:"string"},seconds:{type:"number",default:2},baudrate:{type:"integer",default:115200},max_bytes:{type:"integer",default:4096}},required:["approval_id","device_id"]}, annotations:CONTROL },
  { name:"prepare_scan_preview", description:"Create a local approval request for a low-resolution scanner preview; no scan occurs.", inputSchema:{type:"object",properties:{...relayDeviceProp,device_id:{type:"string"}},required:["device_id"]}, annotations:CONTROL },
  { name:"scan_preview", description:"Reserved scanner acquisition action. The local adapter remains disabled until hardware validation.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},device_id:{type:"string"}},required:["approval_id","device_id"]}, annotations:PHYSICAL },
  { name:"prepare_document_print", description:"Hash and preflight a local file and create an exact local print approval. Does not print.", inputSchema:{type:"object",properties:{...relayDeviceProp,device_id:{type:"string"},file_ref:{type:"string"},copies:{type:"integer",default:1}},required:["device_id","file_ref"]}, annotations:CONTROL },
  { name:"start_document_print", description:"Attempt an approved print through the local physical-action gate. Physical printing remains disabled by default.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},device_id:{type:"string"},file_ref:{type:"string"},copies:{type:"integer",default:1}},required:["approval_id","device_id","file_ref"]}, annotations:PHYSICAL },
  { name:"pending_approvals", description:"List unexpired local Project Relay approval requests waiting for workstation consent.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"list_bridges", description:"List Project Relay capability bridges and their trust/risk metadata.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"get_bridge", description:"Inspect one capability bridge and its declared capabilities.", inputSchema:{type:"object",properties:{...relayDeviceProp,bridge_id:{type:"string"}},required:["bridge_id"]}, annotations:INSPECTION },
  { name:"plan_bridge_action", description:"Plan a bridge action without executing it; returns risk, approval requirement and executability.", inputSchema:{type:"object",properties:{...relayDeviceProp,bridge_id:{type:"string"},action:{type:"string"},args:{type:"object"}},required:["bridge_id","action"]}, annotations:INSPECTION },
  { name:"execute_bridge_read", description:"Execute only a curated read-only action on a trusted capability bridge. Writes and physical actions fail closed.", inputSchema:{type:"object",properties:{...relayDeviceProp,bridge_id:{type:"string"},action:{type:"string"},args:{type:"object"}},required:["bridge_id","action"]}, annotations:INSPECTION },
  { name:"commandport_get_file_info", description:"Read metadata for one file or folder inside approved workstation roots.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"}},required:["path"]}, annotations:INSPECTION },
  { name:"commandport_list_directory", description:"List files and folders inside approved workstation roots.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},depth:{type:"integer",default:1,minimum:0,maximum:4},max_entries:{type:"integer",default:500,minimum:1,maximum:2000}},required:["path"]}, annotations:INSPECTION },
  { name:"commandport_search_files", description:"Search file and folder names inside an approved root with bounded traversal.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},pattern:{type:"string",default:"*"},max_results:{type:"integer",default:200,minimum:1,maximum:1000},max_depth:{type:"integer",default:8,minimum:0,maximum:32},include_dirs:{type:"boolean",default:false}},required:["path"]}, annotations:INSPECTION },
  { name:"commandport_search_text", description:"Search bounded UTF-8 text content inside approved roots.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},query:{type:"string"},pattern:{type:"string",default:"*"},case_sensitive:{type:"boolean",default:false},max_results:{type:"integer",default:100,minimum:1,maximum:500},max_depth:{type:"integer",default:8,minimum:0,maximum:32},max_file_bytes:{type:"integer",default:1000000,minimum:1,maximum:2000000}},required:["path","query"]}, annotations:INSPECTION },
  { name:"commandport_read_text_file", description:"Read a bounded UTF-8 range from a file inside approved workstation roots.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},offset:{type:"integer",default:0,minimum:0},length:{type:"integer",default:64000,minimum:1,maximum:256000}},required:["path"]}, annotations:INSPECTION },
  { name:"commandport_list_processes", description:"List local Windows processes without changing them.", inputSchema:{type:"object",properties:{...relayDeviceProp,limit:{type:"integer",default:250,minimum:1,maximum:1000}}}, annotations:INSPECTION },
  { name:"commandport_list_process_details", description:"Owner-routed read-only process details with executable identity and command arguments redacted.", inputSchema:{type:"object",properties:{...relayDeviceProp,limit:{type:"integer",default:250,minimum:1,maximum:500}}}, annotations:INSPECTION },
  { name:"commandport_list_services", description:"Owner-routed read-only Windows service inventory with service name, display name, status and start type.", inputSchema:{type:"object",properties:{...relayDeviceProp,limit:{type:"integer",default:250,minimum:1,maximum:500}}}, annotations:INSPECTION },
  { name:"commandport_prepare_service", description:"Prepare an exact local approval for starting, stopping or restarting one named Windows service. Does not change the service.", inputSchema:{type:"object",properties:{...relayDeviceProp,service:{type:"string",minLength:1,maxLength:128},action:{type:"string",enum:["start","stop","restart"]}},required:["service","action"]}, annotations:CONTROL },
  { name:"commandport_service", description:"Execute only the exact owner-routed Windows service action approved locally.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},service:{type:"string",minLength:1,maxLength:128},action:{type:"string",enum:["start","stop","restart"]}},required:["approval_id","service","action"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_list_windows", description:"List visible top-level Windows application windows without changing focus.", inputSchema:{type:"object",properties:{...relayDeviceProp,limit:{type:"integer",default:200,minimum:1,maximum:500}}}, annotations:INSPECTION },
  { name:"commandport_open_url", description:"Open one validated http(s) URL in the linked workstation's default browser. This navigates to an external site but does not click or submit anything.", inputSchema:{type:"object",properties:{...relayDeviceProp,url:{type:"string",maxLength:4096}},required:["url"]}, annotations:OPEN_WORLD },
  { name:"commandport_focus_window", description:"Bring one existing top-level Windows window to the foreground without clicking or typing.", inputSchema:{type:"object",properties:{...relayDeviceProp,window_handle:{type:"integer",minimum:1}},required:["window_handle"]}, annotations:CONTROL },
  { name:"commandport_prepare_click", description:"Create an exact local approval request for one mouse click at fixed screen coordinates. Does not click.", inputSchema:{type:"object",properties:{...relayDeviceProp,x:{type:"integer"},y:{type:"integer"},button:{type:"string",enum:["left","right"],default:"left"},clicks:{type:"integer",enum:[1,2],default:1}},required:["x","y"]}, annotations:CONTROL },
  { name:"commandport_click", description:"Execute only the exact mouse click approved locally. Because a general click can trigger external actions, treat it as potentially destructive.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},x:{type:"integer"},y:{type:"integer"},button:{type:"string",enum:["left","right"],default:"left"},clicks:{type:"integer",enum:[1,2],default:1}},required:["approval_id","x","y"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_prepare_type_text", description:"Create an exact local approval request to type text into the active window. Does not type.", inputSchema:{type:"object",properties:{...relayDeviceProp,text:{type:"string",maxLength:4000},press_enter:{type:"boolean",default:false}},required:["text"]}, annotations:CONTROL },
  { name:"commandport_type_text", description:"Type only the exact approved text into the active window, optionally followed by Enter. General typing can submit forms or trigger external actions.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},text:{type:"string",maxLength:4000},press_enter:{type:"boolean",default:false}},required:["approval_id","text"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_prepare_write_file", description:"Create an exact local approval request for one bounded UTF-8 file write.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},content:{type:"string"},mode:{type:"string",enum:["rewrite","append"],default:"rewrite"}},required:["path","content"]}, annotations:CONTROL },
  { name:"commandport_write_file", description:"Write only the exact path/content/mode approved locally.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},path:{type:"string"},content:{type:"string"},mode:{type:"string",enum:["rewrite","append"],default:"rewrite"}},required:["approval_id","path","content"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_prepare_run_command", description:"Create an exact local approval request for one bounded PowerShell command.", inputSchema:{type:"object",properties:{...relayDeviceProp,command:{type:"string"},cwd:{type:"string"},timeout_seconds:{type:"integer",default:60,minimum:1,maximum:300}},required:["command"]}, annotations:CONTROL },
  { name:"commandport_run_command", description:"Run only the exact PowerShell command/cwd/timeout approved locally.", inputSchema:{type:"object",properties:{...relayDeviceProp,approval_id:{type:"string"},command:{type:"string"},cwd:{type:"string"},timeout_seconds:{type:"integer",default:60,minimum:1,maximum:300}},required:["approval_id","command"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_hash_file", description:"Compute SHA-256 for one file inside approved workstation roots without returning file content.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"}},required:["path"]}, annotations:INSPECTION },
  { name:"commandport_read_url", description:"Fetch a bounded public http(s) resource. Rejects credential-shaped URLs and private/loopback/link-local/reserved targets.", inputSchema:{type:"object",properties:{...relayDeviceProp,url:{type:"string",maxLength:4096},timeout_seconds:{type:"integer",default:20,minimum:1,maximum:30},max_bytes:{type:"integer",default:256000,minimum:1,maximum:1000000}},required:["url"]}, annotations:OPEN_WORLD_READ },
  { name:"commandport_get_runtime_config", description:"Read bounded non-secret Project Relay runtime preferences, executable availability, approved roots and owner-control status.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },

  { name:"commandport_owner_read_multiple_files", description:"Owner Full Control: read bounded UTF-8 ranges from up to 20 files inside approved roots. Requires owner OAuth routing and the workstation-local Owner Full Control switch.", inputSchema:{type:"object",properties:{...relayDeviceProp,paths:{type:"array",items:{type:"string"},minItems:1,maxItems:20},offset:{type:"integer",default:0},length:{type:"integer",default:64000,minimum:1,maximum:256000}},required:["paths"]}, annotations:INSPECTION },
  { name:"commandport_owner_preview_text_replace", description:"Owner Full Control: preview a bounded exact/regex text replacement as a unified diff without writing.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},find:{type:"string",maxLength:20000},replace:{type:"string",maxLength:200000},regex:{type:"boolean",default:false},count:{type:"integer",default:0,minimum:0,maximum:10000}},required:["path","find","replace"]}, annotations:INSPECTION },
  { name:"commandport_owner_apply_text_replace", description:"Owner Full Control: apply a previewable UTF-8 text replacement with optional expected SHA-256 conflict check and rollback checkpoint.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},find:{type:"string",maxLength:20000},replace:{type:"string",maxLength:200000},regex:{type:"boolean",default:false},count:{type:"integer",default:0,minimum:0,maximum:10000},expected_sha256:{type:"string",maxLength:64}},required:["path","find","replace"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_rollback_text_edit", description:"Owner Full Control: rollback one Relay text-edit checkpoint only when the current file still matches the checkpoint post-edit hash.", inputSchema:{type:"object",properties:{...relayDeviceProp,checkpoint_id:{type:"string",maxLength:64}},required:["checkpoint_id"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_read_document", description:"Owner Full Control: format-aware bounded read of CSV, JSON, XLSX/XLSM, PDF, DOCX or text inside approved roots.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},sheet:{type:"string"},page_start:{type:"integer",default:0,minimum:0},page_count:{type:"integer",default:10,minimum:1,maximum:20}},required:["path"]}, annotations:INSPECTION },
  { name:"commandport_owner_search_document", description:"Owner Full Control: search text extracted from a supported document without modifying it.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},query:{type:"string",maxLength:1000},case_sensitive:{type:"boolean",default:false},sheet:{type:"string"},max_results:{type:"integer",default:100,minimum:1,maximum:500}},required:["path","query"]}, annotations:INSPECTION },
  { name:"commandport_owner_recent_tool_calls", description:"Owner Full Control: return bounded local tool-call history containing action names and argument shapes only; argument values are never logged.", inputSchema:{type:"object",properties:{...relayDeviceProp,limit:{type:"integer",default:50,minimum:1,maximum:200}}}, annotations:INSPECTION },
  { name:"commandport_owner_runtime_config", description:"Owner Full Control: update bounded runtime preferences such as default shell, blocked command names, output limit and local tool-history preference.", inputSchema:{type:"object",properties:{...relayDeviceProp,default_shell:{type:"string",enum:["powershell","cmd","wsl","python","node","r"]},blocked_commands:{type:"array",items:{type:"string",maxLength:120},maxItems:100},max_output_chars:{type:"integer",minimum:8000,maximum:1000000},tool_history_enabled:{type:"boolean"}}}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_terminal_start", description:"Owner Full Control: start one bounded interactive terminal session using PowerShell, cmd, WSL, Python, Node or R when installed. This is not a sandbox.", inputSchema:{type:"object",properties:{...relayDeviceProp,shell:{type:"string",enum:["default","powershell","cmd","wsl","python","node","r"],default:"default"},command:{type:"string",maxLength:12000},cwd:{type:"string"}}}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_terminal_list", description:"Owner Full Control: list Relay terminal-session identities and status without exposing command text.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"commandport_owner_terminal_read", description:"Owner Full Control: read bounded paginated output from one Relay terminal session.", inputSchema:{type:"object",properties:{...relayDeviceProp,session_id:{type:"string"},offset:{type:"integer"},length:{type:"integer",default:32000,minimum:1,maximum:64000}},required:["session_id"]}, annotations:INSPECTION },
  { name:"commandport_owner_terminal_write", description:"Owner Full Control: send bounded text to one Relay terminal session. Do not send passwords, tokens, card data or 2FA values.", inputSchema:{type:"object",properties:{...relayDeviceProp,session_id:{type:"string"},text:{type:"string",maxLength:8000},press_enter:{type:"boolean",default:true}},required:["session_id","text"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_terminal_stop", description:"Owner Full Control: terminate one Relay-managed terminal session, optionally its Windows process tree.", inputSchema:{type:"object",properties:{...relayDeviceProp,session_id:{type:"string"},force:{type:"boolean",default:false},tree:{type:"boolean",default:true}},required:["session_id"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_fs_mkdir", description:"Owner Full Control: create a directory tree at an explicit absolute path.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"}},required:["path"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_fs_copy", description:"Owner Full Control: copy one explicit file or directory to an explicit destination.", inputSchema:{type:"object",properties:{...relayDeviceProp,source:{type:"string"},destination:{type:"string"}},required:["source","destination"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_fs_move", description:"Owner Full Control: move or rename one explicit file or directory.", inputSchema:{type:"object",properties:{...relayDeviceProp,source:{type:"string"},destination:{type:"string"}},required:["source","destination"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_fs_delete", description:"Owner Full Control: delete one explicit file, or a directory only when recursive is deliberately requested.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},recursive:{type:"boolean",default:false}},required:["path"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_process_start", description:"Owner Full Control: start one explicit executable with bounded argument count. No shell expansion is used.", inputSchema:{type:"object",properties:{...relayDeviceProp,executable:{type:"string"},args:{type:"array",items:{type:"string",maxLength:4096},maxItems:64},cwd:{type:"string"}},required:["executable"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_process_terminate", description:"Owner Full Control: terminate a specific PID with safeguards against system/self termination.", inputSchema:{type:"object",properties:{...relayDeviceProp,pid:{type:"integer",minimum:1},tree:{type:"boolean",default:false},force:{type:"boolean",default:false}},required:["pid"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_service_action", description:"Owner Full Control: start, stop or restart one exact Windows service name.", inputSchema:{type:"object",properties:{...relayDeviceProp,name:{type:"string",maxLength:256},action:{type:"string",enum:["start","stop","restart"]}},required:["name","action"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_software_list", description:"Owner Full Control: list installed software through Winget with bounded output.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"commandport_owner_software_search", description:"Owner Full Control: search Winget packages with bounded output.", inputSchema:{type:"object",properties:{...relayDeviceProp,query:{type:"string",maxLength:200}},required:["query"]}, annotations:OPEN_WORLD },
  { name:"commandport_owner_software_install", description:"Owner Full Control: silently install one exact Winget package id.", inputSchema:{type:"object",properties:{...relayDeviceProp,package_id:{type:"string",maxLength:200}},required:["package_id"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_software_uninstall", description:"Owner Full Control: uninstall one exact Winget package id.", inputSchema:{type:"object",properties:{...relayDeviceProp,package_id:{type:"string",maxLength:200}},required:["package_id"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_software_upgrade", description:"Owner Full Control: upgrade one exact Winget package id.", inputSchema:{type:"object",properties:{...relayDeviceProp,package_id:{type:"string",maxLength:200}},required:["package_id"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_ui_find_control", description:"Owner Full Control: find one exact visible enabled non-password UI Automation control without dumping the UI tree.", inputSchema:{type:"object",properties:{...relayDeviceProp,label:{type:"string",maxLength:160},role:{type:"string",enum:["button","link","menuitem","tab","checkbox","radio","listitem","edit","combobox","treeitem"],default:"button"}},required:["label"]}, annotations:INSPECTION },
  { name:"commandport_owner_ui_click_control", description:"Owner Full Control: click one exact visible enabled non-password UI Automation control after context checks.", inputSchema:{type:"object",properties:{...relayDeviceProp,label:{type:"string",maxLength:160},role:{type:"string",enum:["button","link","menuitem","tab","checkbox","radio","listitem","combobox","treeitem"],default:"button"}},required:["label"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_self_update", description:"Owner Full Control: stage only a published stable/beta Project Relay release through the existing checksum-verified rollback-capable updater.", inputSchema:{type:"object",properties:{...relayDeviceProp,channel:{type:"string",enum:["stable","beta"],default:"stable"}}}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_write_csv", description:"Owner Full Control: create or replace a CSV file using structured rows, with optional expected SHA-256 conflict protection.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},rows:{type:"array",items:{type:"array",items:{}},maxItems:5000},expected_sha256:{type:"string",maxLength:64}},required:["path","rows"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_write_xlsx", description:"Owner Full Control: create or replace an XLSX workbook from structured worksheet rows, with optional expected SHA-256 conflict protection.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},sheets:{type:"object"},expected_sha256:{type:"string",maxLength:64}},required:["path","sheets"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_update_xlsx_cells", description:"Owner Full Control: update explicit XLSX/XLSM cell coordinates with optimistic SHA-256 conflict protection and a rollback checkpoint.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},sheet:{type:"string",maxLength:31},cells:{type:"object"},expected_sha256:{type:"string",maxLength:64}},required:["path","sheet","cells"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_write_docx", description:"Owner Full Control: create or replace a DOCX document from bounded text using a format-aware writer.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},text:{type:"string",maxLength:500000},title:{type:"string",maxLength:240},expected_sha256:{type:"string",maxLength:64}},required:["path","text"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_write_pdf", description:"Owner Full Control: create or replace a text PDF using a format-aware writer; generic text writes never touch PDFs.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},text:{type:"string",maxLength:500000},title:{type:"string",maxLength:100},expected_sha256:{type:"string",maxLength:64}},required:["path","text"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_rollback_document", description:"Owner Full Control: rollback one format-aware document checkpoint only if the current file still matches its post-write hash.", inputSchema:{type:"object",properties:{...relayDeviceProp,checkpoint_id:{type:"string",maxLength:64}},required:["checkpoint_id"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_sandbox_status", description:"Owner Full Control: inspect whether the fixed Python/Node Docker sandbox images are locally installed and report the hard isolation settings used by Relay.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"commandport_owner_sandbox_run", description:"Owner Full Control: execute bounded Python or Node code inside an already-installed Docker image with no network, no host mounts, read-only root, dropped capabilities and CPU/memory/PID limits.", inputSchema:{type:"object",properties:{...relayDeviceProp,language:{type:"string",enum:["python","node"]},code:{type:"string",maxLength:200000},timeout_seconds:{type:"integer",default:60,minimum:1,maximum:120}},required:["language","code"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_read_image", description:"Owner Full Control: read one local image as a bounded JPEG preview for visual inspection; file content is owner-only and the workstation-local Owner Full Control switch must be enabled.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},max_width:{type:"integer",default:1280,minimum:128,maximum:1920},jpeg_quality:{type:"integer",default:70,minimum:30,maximum:85}},required:["path"]}, annotations:INSPECTION },
  { name:"commandport_owner_write_json", description:"Owner Full Control: create or replace JSON using structured input and optional expected SHA-256 conflict protection.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},value:{},pretty:{type:"boolean",default:true},expected_sha256:{type:"string",maxLength:64}},required:["path","value"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_replace_docx_text", description:"Owner Full Control: replace exact text in DOCX paragraphs/tables using a format-aware writer and rollback checkpoint.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},find:{type:"string",maxLength:20000},replace:{type:"string",maxLength:200000},expected_sha256:{type:"string",maxLength:64}},required:["path","find","replace"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_pdf_delete_pages", description:"Owner Full Control: delete explicit one-based PDF pages with optimistic SHA-256 conflict protection; refuses deleting every page.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},pages:{type:"array",items:{type:"integer",minimum:1},minItems:1,maxItems:500},expected_sha256:{type:"string",maxLength:64}},required:["path","pages"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_pdf_insert_pdf", description:"Owner Full Control: insert pages from another approved-root PDF into a target PDF at an explicit zero-based position.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},source_path:{type:"string"},position:{type:"integer",default:0,minimum:0},expected_sha256:{type:"string",maxLength:64}},required:["path","source_path"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_ssh_start", description:"Owner Full Control: start a passwordless SSH terminal session using key/agent authentication only. Password and keyboard-interactive authentication are disabled and strict host-key checking is required.", inputSchema:{type:"object",properties:{...relayDeviceProp,host:{type:"string",maxLength:253},user:{type:"string",maxLength:128},port:{type:"integer",default:22,minimum:1,maximum:65535},identity_file:{type:"string"},cwd:{type:"string"}},required:["host"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_zip_list", description:"Owner Full Control: inspect a ZIP archive inside approved roots. Rejects traversal and symlink entries and returns bounded metadata only.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},max_entries:{type:"integer",default:1000,minimum:1,maximum:5000}},required:["path"]}, annotations:INSPECTION },
  { name:"commandport_owner_zip_create", description:"Owner Full Control: create a ZIP from explicit approved-root files/directories, refusing symlinks and enforcing total file/byte limits.", inputSchema:{type:"object",properties:{...relayDeviceProp,destination:{type:"string"},sources:{type:"array",items:{type:"string"},minItems:1,maxItems:200},compression:{type:"integer",default:6,minimum:0,maximum:9}},required:["destination","sources"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_zip_extract", description:"Owner Full Control: extract a ZIP into an approved destination with path-traversal, symlink, single-file, total-size and compression-ratio protections.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},destination:{type:"string"},overwrite:{type:"boolean",default:false}},required:["path","destination"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_preview_text_transaction", description:"Owner Full Control: preview up to 20 text edits across distinct approved-root files, returning per-file hashes and bounded unified diffs without writing.", inputSchema:{type:"object",properties:{...relayDeviceProp,edits:{type:"array",items:{type:"object"},minItems:1,maxItems:20}},required:["edits"]}, annotations:INSPECTION },
  { name:"commandport_owner_apply_text_transaction", description:"Owner Full Control: atomically stage and apply up to 20 distinct text edits after validating all expected SHA-256 values; restores already-written files if a later replace fails.", inputSchema:{type:"object",properties:{...relayDeviceProp,edits:{type:"array",items:{type:"object"},minItems:1,maxItems:20}},required:["edits"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_rollback_text_transaction", description:"Owner Full Control: rollback an entire Relay multi-file text transaction only when every current file still matches its post-transaction hash.", inputSchema:{type:"object",properties:{...relayDeviceProp,transaction_id:{type:"string",maxLength:64}},required:["transaction_id"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_search_content", description:"Owner Full Control: bounded regex or literal content search across approved roots with file globs and up to five context lines. Binary/oversized files and symlink traversal are skipped.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},query:{type:"string",maxLength:10000},regex:{type:"boolean",default:false},case_sensitive:{type:"boolean",default:false},globs:{type:"array",items:{type:"string",maxLength:260},maxItems:20},max_results:{type:"integer",default:100,minimum:1,maximum:500},max_depth:{type:"integer",default:12,minimum:0,maximum:32},max_file_bytes:{type:"integer",default:1000000,minimum:1,maximum:5000000},context_lines:{type:"integer",default:1,minimum:0,maximum:5}},required:["path","query"]}, annotations:INSPECTION },
  { name:"commandport_owner_scheduled_tasks_list", description:"Owner Full Control: list bounded Windows Scheduled Task names, paths and states without action arguments or credentials.", inputSchema:{type:"object",properties:{...relayDeviceProp,limit:{type:"integer",default:500,minimum:1,maximum:2000}}}, annotations:INSPECTION },
  { name:"commandport_owner_scheduled_task_action", description:"Owner Full Control: start/stop/enable/disable one exact Windows Scheduled Task. Project Relay recovery tasks are protected from remote stop/disable.", inputSchema:{type:"object",properties:{...relayDeviceProp,name:{type:"string",maxLength:240},task_path:{type:"string",default:"\\",maxLength:500},action:{type:"string",enum:["start","stop","enable","disable"],default:"start"}},required:["name"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_capability_report", description:"Inspect Project Relay workstation capability categories and dependency availability without executing a mutation or returning secret values.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"commandport_health_report", description:"Return one bounded non-sensitive workstation health snapshot covering watchdog freshness, updater/backoff state, rollback availability, startup recovery tasks, and whether Owner Full Control is enabled.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:PURE_READ },
  { name:"commandport_owner_system_snapshot", description:"Owner Full Control: return bounded OS, CPU-count, boot/memory and home-disk diagnostics for the selected workstation.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"commandport_owner_network_summary", description:"Owner Full Control: return bounded Windows interface, IP, gateway and DNS diagnostics. Does not scan ports or services.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"commandport_owner_event_log_query", description:"Owner Full Control: query bounded Windows Event Log entries by log, recent time window and optional level; per-event messages are truncated.", inputSchema:{type:"object",properties:{...relayDeviceProp,log_name:{type:"string",default:"System",maxLength:128},minutes:{type:"integer",default:60,minimum:1,maximum:10080},max_events:{type:"integer",default:100,minimum:1,maximum:250},level:{type:"string",enum:["critical","error","warning","information","verbose"]}}}, annotations:INSPECTION },

  { name:"commandport_owner_search_start", description:"Owner Full Control: start a bounded background filename or content search across approved roots. Returns a search-session id for paginated polling.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},search_type:{type:"string",enum:["files","content"]},query:{type:"string",maxLength:10000},regex:{type:"boolean",default:false},case_sensitive:{type:"boolean",default:false},globs:{type:"array",items:{type:"string",maxLength:260},maxItems:20},max_depth:{type:"integer",default:12,minimum:0,maximum:32},max_file_bytes:{type:"integer",default:1000000,minimum:1,maximum:5000000}},required:["path","search_type","query"]}, annotations:CONTROL },
  { name:"commandport_owner_search_read", description:"Owner Full Control: read a bounded page of results from one background Relay search session. Negative offsets provide tail behavior.", inputSchema:{type:"object",properties:{...relayDeviceProp,session_id:{type:"string"},offset:{type:"integer",default:0},length:{type:"integer",default:100,minimum:1,maximum:500}},required:["session_id"]}, annotations:INSPECTION },
  { name:"commandport_owner_search_list", description:"Owner Full Control: list active/recent Relay search sessions and their progress without returning search result contents.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:INSPECTION },
  { name:"commandport_owner_search_stop", description:"Owner Full Control: cancel one background Relay file/content search by its returned session_id. Cancellation can leave incomplete results and the same session cannot resume; start a new search to repeat it. Already collected results remain readable until normal session expiry. This does not modify files or stop other applications.", inputSchema:{type:"object",properties:{...relayDeviceProp,session_id:{type:"string"}},required:["session_id"]}, annotations:SEARCH_CANCELLATION },
  { name:"commandport_owner_usage_stats", description:"Owner Full Control: return bounded local action counts, success/failure rates and timing aggregates. Argument and output values are never included.", inputSchema:{type:"object",properties:{...relayDeviceProp,hours:{type:"integer",default:24,minimum:1,maximum:720},top_actions:{type:"integer",default:20,minimum:1,maximum:100}}}, annotations:INSPECTION },
  { name:"commandport_owner_read_file_lines", description:"Owner Full Control: read bounded UTF-8 file lines from an approved root with positive pagination or negative tail offsets.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},offset:{type:"integer",default:0},length:{type:"integer",default:1000,minimum:1,maximum:5000}},required:["path"]}, annotations:INSPECTION },

  { name:"commandport_ping", description:"Ping the selected linked workstation through the Relay task channel and return its current version/host response.", inputSchema:{type:"object",properties:{...relayDeviceProp}}, annotations:PURE_READ },
  { name:"commandport_owner_power_action", description:"Owner Full Control: shutdown, restart, sleep or lock the selected Windows workstation. Requires OAuth owner routing and the workstation-local Owner Full Control switch.", inputSchema:{type:"object",properties:{...relayDeviceProp,action:{type:"string",enum:["shutdown","restart","sleep","lock"]},delay_seconds:{type:"integer",default:0,minimum:0,maximum:3600}},required:["action"]}, annotations:DESKTOP_MUTATION },

  { name:"commandport_owner_write_text_file", description:"Owner Full Control: create, rewrite or append a bounded UTF-8 text file inside approved roots with optional expected SHA-256 conflict protection and rollback checkpoint.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},content:{type:"string",maxLength:2000000},mode:{type:"string",enum:["rewrite","append"],default:"rewrite"},expected_sha256:{type:"string",maxLength:64}},required:["path","content"]}, annotations:DESKTOP_MUTATION },
  { name:"commandport_owner_update_xlsx_range", description:"Owner Full Control: update an exact Sheet!A1:C10 Excel range from a 2D value array with exact dimension checks, optimistic SHA-256 conflict protection and rollback checkpoint.", inputSchema:{type:"object",properties:{...relayDeviceProp,path:{type:"string"},range_ref:{type:"string",maxLength:200},values:{type:"array",items:{type:"array",items:{}},minItems:1,maxItems:5000},expected_sha256:{type:"string",maxLength:64}},required:["path","range_ref","values"]}, annotations:DESKTOP_MUTATION },
];

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,mcp-protocol-version",
    "access-control-allow-methods": "POST,OPTIONS",
  };
}
function response(body: unknown, status=200, extra: Record<string,string>={}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...cors(), ...extra },
  });
}
function rpc(id: unknown, result: unknown) { return response({jsonrpc:"2.0",id,result}); }
function rpcError(id: unknown, code: number, message: string) { return response({jsonrpc:"2.0",id,error:{code,message}}); }
function authChallenge() {
  const challenge = `Bearer resource_metadata="${RESOURCE_METADATA}", error="invalid_token", error_description="Project Relay account linking is required"`;
  return {
    content: [{ type: "text", text: "Authentication required. Connect your Project Relay account to continue." }],
    _meta: { "mcp/www_authenticate": [challenge] },
    isError: true,
  };
}
function resourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [AUTH_SERVER],
    resource_documentation: OAUTH_UI,
  };
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,"0")).join("");
}
function bearer(req: Request) {
  const h=req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - part.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function audienceMatches(value: unknown) {
  if (typeof value === "string") return value === RESOURCE;
  if (Array.isArray(value)) return value.includes(RESOURCE);
  return false;
}

async function authorize(req: Request) {
  const token=bearer(req);
  if(!token) return null;

  const tokenHash=await sha256(token);
  const {data:controller,error}=await db.from("project_relay_controller_keys")
    .select("id,name").eq("token_hash",tokenHash).eq("enabled",true).maybeSingle();
  if(error) throw error;
  if(controller) {
    await db.from("project_relay_controller_keys")
      .update({last_used_at:new Date().toISOString()}).eq("id",controller.id);
    return { kind:"controller", subject:String(controller.id), name:controller.name };
  }

  const {data:oauthToken,error:tokenError}=await db.from("project_relay_oauth_tokens")
    .select("user_id,client_id,resource,scope,access_expires_at,revoked_at")
    .eq("access_token_hash",tokenHash)
    .maybeSingle();
  if(tokenError) throw tokenError;
  if(!oauthToken) return null;
  if(oauthToken.revoked_at) return null;
  if(String(oauthToken.resource) !== RESOURCE) return null;
  if(new Date(String(oauthToken.access_expires_at)).getTime() <= Date.now()) return null;
  const scopes=String(oauthToken.scope ?? "").split(/\s+/).filter(Boolean);
  if(!scopes.includes(REQUIRED_SCOPE)) return null;

  await db.from("project_relay_oauth_tokens")
    .update({last_used_at:new Date().toISOString()})
    .eq("access_token_hash",tokenHash);

  const {data:userData,error:userError}=await db.auth.admin.getUserById(String(oauthToken.user_id));
  if(userError || !userData.user) return null;

  const {data:account,error:accountError}=await db.from("project_relay_accounts")
    .select("plan,status,entitlements,trial_ends_at")
    .eq("user_id",userData.user.id)
    .single();
  if(accountError) throw accountError;
  if(!["active","trial"].includes(String(account.status))) return null;

  return {
    kind:"oauth",
    subject:userData.user.id,
    email:userData.user.email ?? null,
    name:typeof userData.user.user_metadata?.full_name === "string"
      ? userData.user.user_metadata.full_name
      : null,
    client_id:String(oauthToken.client_id),
    scope:String(oauthToken.scope ?? ""),
    plan:account.plan,
    account_status:account.status,
    entitlements:account.entitlements ?? {},
  };
}

function requireWhatsappOAuth(identity: any) {
  if (identity?.kind !== "oauth") {
    throw new Error("WhatsApp Relay requires an authenticated Project Relay user account");
  }
  return String(identity.subject);
}

function normalizeWhatsappNumber(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(digits)) throw new Error("Enter a valid WhatsApp phone number including country code");
  return digits;
}

function compactWhatsappMessage(row: any) {
  return {
    id: row.id,
    wamid: row.wamid,
    direction: row.direction,
    from: row.from_number,
    to: row.to_number,
    type: row.message_type,
    body: row.body,
    status: row.status,
    timestamp: row.message_timestamp ?? row.created_at,
    reply_to_wamid: row.reply_to_wamid,
  };
}

async function resolveWhatsappAccount(identity: any, value?: unknown) {
  const userId = requireWhatsappOAuth(identity);
  let q = db.from("project_relay_whatsapp_accounts")
    .select("id,user_id,phone_number_id,business_account_id,display_phone_number,label,enabled,coexistence,created_at")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (value) q = q.eq("id", String(value));
  const { data, error } = await q.order("created_at", { ascending: true }).limit(value ? 1 : 2);
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("No linked WhatsApp Business number found for this Project Relay account");
  if (!value && data.length > 1) throw new Error("Multiple WhatsApp Business numbers are linked; specify account_id");
  return data[0];
}

async function whatsappGraph(path: string, init: RequestInit = {}) {
  const token = whatsappAccessToken();
  if (!token) throw new Error("WhatsApp Relay server credential is not configured");
  const cleanPath = path.replace(/^\/+/, "");
  const res = await fetch(`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${cleanPath}`, {
    ...init,
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const code = data?.error?.code ? ` Meta code ${String(data.error.code)}.` : "";
    throw new Error(`WhatsApp API request failed with HTTP ${res.status}.${code}`);
  }
  return data;
}

async function whatsappAudit(accountId: string | null, userId: string | null, eventType: string, detail: Record<string,unknown>) {
  const { error } = await db.from("project_relay_whatsapp_audit").insert({
    account_id: accountId,
    user_id: userId,
    event_type: eventType,
    detail,
  });
  if (error) {
    console.error("WhatsApp audit insert failed", error.message);
    return false;
  }
  return true;
}

async function resolveDevice(value: unknown, identity: any) {
  let allowedIds: string[] | null = null;
  if(identity?.kind === "oauth"){
    const {data:links,error:linkError}=await db.from("project_relay_user_devices")
      .select("device_id,role").eq("user_id",identity.subject);
    if(linkError) throw linkError;
    allowedIds=(links ?? []).map((row:any)=>String(row.device_id));
    if(allowedIds.length===0) throw new Error("No Project Relay workstation is linked to this account");
  }

  let q=db.from("project_relay_devices").select("id,name,last_seen,enabled,info").eq("enabled",true);
  if(allowedIds) q=q.in("id",allowedIds);
  if(value){
    const s=String(value);
    q=/^[0-9a-f-]{36}$/i.test(s) ? q.eq("id",s) : q.ilike("name",s);
  }
  const {data,error}=await q.order("last_seen",{ascending:false,nullsFirst:false}).limit(2);
  if(error) throw error;
  if(!data || data.length===0) throw new Error("No matching linked Project Relay workstation");
  if(!value && data.length>1) throw new Error("Multiple Relay workstations are linked; specify relay_device");
  const device=data[0];
  if(!device.last_seen) throw new Error("Project Relay workstation is offline");
  const age=Date.now()-new Date(device.last_seen).getTime();
  if(age>90_000) throw new Error("Project Relay workstation has not checked in recently");
  return device;
}
async function resolveOwnerDevice(value: unknown, identity: any) {
  if(identity?.kind !== "oauth") throw new Error("Owner-authenticated OAuth account is required for remote desktop control");
  const device=await resolveDevice(value, identity);
  const {data:link,error}=await db.from("project_relay_user_devices")
    .select("role")
    .eq("user_id",identity.subject)
    .eq("device_id",device.id)
    .maybeSingle();
  if(error) throw error;
  if(!link || String(link.role) !== "owner") throw new Error("Owner role is required for remote desktop control");
  return device;
}

async function queueAndWait(action: string, args: Record<string,unknown>, identity: any) {
  if(!ACTIONS.has(action)) throw new Error("relay_stage:action_not_allowed");
  let device;
  try {
    device=OWNER_CONTROL_TOOLS.has(action)
      ? await resolveOwnerDevice(args?.relay_device, identity)
      : await resolveDevice(args?.relay_device, identity);
  } catch {
    throw new Error("relay_stage:device_resolution");
  }
  const supported = device.info?.actions;
  if(!Array.isArray(supported) || !supported.includes(action)) {
    throw new Error("relay_stage:capability_check");
  }
  const payload={...(args ?? {})};
  delete payload.relay_device;
  const expires=new Date(Date.now()+120_000).toISOString();
  const {data:task,error}=await db.from("project_relay_tasks")
    .insert({device_id:device.id,action,payload,expires_at:expires})
    .select("id").single();
  if(error) throw new Error("relay_stage:task_insert");

  const deadline=Date.now()+55_000;
  while(Date.now()<deadline){
    const {data:row,error:e}=await db.from("project_relay_tasks")
      .select("status,result,error").eq("id",task.id).single();
    if(e) throw e;
    if(row.status==="done") return {device,result:row.result};
    if(row.status==="error" || row.status==="cancelled") throw new Error(row.error ?? row.status);
    await new Promise((r)=>setTimeout(r,500));
  }
  throw new Error("Project Relay task timed out waiting for workstation response");
}
function textContent(v: unknown) {
  return [{type:"text",text:typeof v==="string" ? v : JSON.stringify(v,null,2)}];
}

function advertisedTools() {
  return tools
    .filter((tool)=>PUBLIC_TOOLS.has(tool.name))
    .map((tool)=>({
      ...tool,
      securitySchemes: SECURITY_SCHEMES,
      _meta: { ...(tool._meta ?? {}), securitySchemes: SECURITY_SCHEMES },
    }));
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors()});

  const url=new URL(req.url);
  if(req.method==="GET" && url.pathname.endsWith("/.well-known/oauth-protected-resource")){
    return response(resourceMetadata(),200);
  }
  if(req.method!=="POST") return response({ok:false,error:"POST only"},405);

  try{
    const msg=await req.json();
    const id=msg.id ?? null;
    const method=String(msg.method ?? "");

    if(method==="initialize") return rpc(id,{
      protocolVersion:"2025-11-25",
      capabilities:{tools:{listChanged:true}},
      serverInfo:{name:"Project Relay",version:"0.7.11"},
      instructions:"Project Relay requires account linking for tool calls. Read-only inspection is available to linked accounts. Owner workstation administration requires both OAuth role=owner and the workstation-local Owner Full Control switch. Normal customer mutations remain exact approval-gated. OAuth owners with workstation-local Owner Full Control may remotely approve one existing exact pending approval through commandport_owner_approve. Sensitive file/document/terminal reads are owner-only. Unknown actions fail closed."
    });
    if(method==="notifications/initialized") return new Response(null,{status:202,headers:cors()});
    if(method==="ping") return rpc(id,{});
    if(method==="tools/list") return rpc(id,{tools:advertisedTools()});

    if(method==="tools/call"){
      const auth=await authorize(req);
      if(!auth) return rpc(id,authChallenge());

      const name=String(msg.params?.name ?? "");
      const args=(msg.params?.arguments ?? {}) as Record<string,unknown>;

      if(name==="get_profile"){
        const profile=auth.kind==="oauth"
          ? {
              id:"usr_"+(await sha256(String(auth.subject))).slice(0,20),
              ...(auth.name ? {name:String(auth.name)} : {}),
              ...(auth.email ? {email:String(auth.email)} : {}),
              nickname:auth.email ? "Project Relay — "+String(auth.email) : "Project Relay account",
            }
          : {
              id:"ctrl_"+(await sha256(String(auth.subject))).slice(0,20),
              name:String(auth.name ?? "Project Relay development controller"),
              nickname:"Project Relay development controller",
            };
        return rpc(id,{
          content:textContent(profile),
          structuredContent:profile,
          isError:false,
        });
      }

      if(name==="get_relay_status"){
        let allowedIds: string[] | null = null;
        if(auth.kind === "oauth"){
          const {data:links,error:linkError}=await db.from("project_relay_user_devices")
            .select("device_id").eq("user_id",auth.subject);
          if(linkError) throw linkError;
          allowedIds=(links ?? []).map((row:any)=>String(row.device_id));
        }

        let workstationsQuery=db.from("project_relay_devices")
          .select("id,name,last_seen,enabled,info").eq("enabled",true);
        if(allowedIds){
          if(allowedIds.length===0){
            const value={
              hosted_version:"0.7.11",
              protocol_version:"2025-11-25",
              published_tool_count:advertisedTools().length,
              stable_release_version:null,
              workstations:[],
              versions_match:true,
              all_online:true,
              all_components_current:false,
              note:"No Project Relay workstations are linked to this account."
            };
            return rpc(id,{content:textContent(value),structuredContent:value});
          }
          workstationsQuery=workstationsQuery.in("id",allowedIds);
        }

        const [{data:devices,error:devicesError},{data:release,error:releaseError}]=await Promise.all([
          workstationsQuery.order("name"),
          db.from("project_relay_releases")
            .select("version,created_at")
            .eq("published",true)
            .eq("channel","stable")
            .order("created_at",{ascending:false})
            .limit(1)
            .maybeSingle()
        ]);
        if(devicesError) throw devicesError;
        if(releaseError) throw releaseError;

        const workstations=(devices ?? []).map((d:any)=>{
          const age=d.last_seen ? Date.now()-new Date(d.last_seen).getTime() : null;
          const info=(d.info && typeof d.info==="object") ? d.info : {};
          return {
            name:String(d.name ?? "Project Relay PC"),
            online:age !== null && age <= 90_000,
            version:typeof info.version==="string" ? info.version : null,
            owner_full_control:info.owner_full_control === true,
          };
        });
        const hostedVersion="0.7.11";
        const stableReleaseVersion=typeof release?.version==="string" ? release.version : null;
        const versionsMatch=workstations.every((w:any)=>w.version===hostedVersion);
        const allOnline=workstations.every((w:any)=>w.online===true);
        const value={
          hosted_version:hostedVersion,
          protocol_version:"2025-11-25",
          published_tool_count:advertisedTools().length,
          stable_release_version:stableReleaseVersion,
          workstations,
          versions_match:versionsMatch,
          all_online:allOnline,
          all_components_current:stableReleaseVersion===hostedVersion && versionsMatch,
          note:"ChatGPT can cache a connector tool catalog for an existing chat. If a newly published tool is missing here, refresh/reconnect the Project Relay plugin or start a new chat."
        };
        return rpc(id,{content:textContent(value),structuredContent:value});
      }


      if(name==="whatsapp_status"){
        const userId=requireWhatsappOAuth(auth);
        const {data,error}=await db.from("project_relay_whatsapp_accounts")
          .select("id,phone_number_id,business_account_id,display_phone_number,label,enabled,coexistence,created_at")
          .eq("user_id",userId)
          .order("created_at",{ascending:true});
        if(error) throw error;
        const value={
          configured:{
            access_token:Boolean(whatsappAccessToken()),
            app_id:Boolean(Deno.env.get("META_APP_ID")),
            app_secret:Boolean(Deno.env.get("META_APP_SECRET")),
            verify_token:Boolean(Deno.env.get("WHATSAPP_VERIFY_TOKEN")),
            graph_version:WHATSAPP_GRAPH_VERSION,
          },
          accounts:(data ?? []).map((row:any)=>({
            id:row.id,
            label:row.label,
            display_phone_number:row.display_phone_number,
            phone_number_id:row.phone_number_id,
            business_account_id:row.business_account_id,
            enabled:row.enabled,
            coexistence:row.coexistence,
          })),
          note:"Credential values are stored server-side and are never returned."
        };
        return rpc(id,{content:textContent(value),structuredContent:value});
      }

      if(name==="whatsapp_link_number"){
        const userId=requireWhatsappOAuth(auth);
        const phoneNumberId=String(args.phone_number_id ?? "").trim();
        if(!/^[0-9]{3,64}$/.test(phoneNumberId)) throw new Error("Invalid WhatsApp phone-number ID");

        const {data:existing,error:existingError}=await db.from("project_relay_whatsapp_accounts")
          .select("id,user_id").eq("phone_number_id",phoneNumberId).maybeSingle();
        if(existingError) throw existingError;
        if(existing && String(existing.user_id)!==userId) throw new Error("This WhatsApp number is already linked to another Relay account");

        const info=await whatsappGraph(`${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,platform_type`);
        const row={
          user_id:userId,
          phone_number_id:phoneNumberId,
          business_account_id:args.business_account_id ? String(args.business_account_id) : null,
          display_phone_number:typeof info?.display_phone_number==="string" ? info.display_phone_number : null,
          label:args.label ? String(args.label) : (typeof info?.verified_name==="string" ? info.verified_name : null),
          coexistence:args.coexistence===true,
          enabled:true,
          updated_at:new Date().toISOString(),
        };

        let linked:any;
        if(existing){
          const {data,error}=await db.from("project_relay_whatsapp_accounts")
            .update(row).eq("id",existing.id).eq("user_id",userId)
            .select("id,phone_number_id,business_account_id,display_phone_number,label,enabled,coexistence").single();
          if(error) throw error;
          linked=data;
        }else{
          const {data,error}=await db.from("project_relay_whatsapp_accounts")
            .insert(row)
            .select("id,phone_number_id,business_account_id,display_phone_number,label,enabled,coexistence").single();
          if(error) throw error;
          linked=data;
        }
        await whatsappAudit(linked.id,userId,"account_linked",{phone_number_id:phoneNumberId,coexistence:linked.coexistence===true});
        return rpc(id,{content:textContent(linked),structuredContent:linked});
      }

      if(name==="whatsapp_subscription_status"){
        const account=await resolveWhatsappAccount(auth,args.account_id);
        const wabaId=String(account.business_account_id ?? "").trim();
        if(!/^\d{3,64}$/.test(wabaId)) throw new Error("This linked number does not have a WABA ID; link it again with business_account_id");
        const result=await whatsappGraph(`${encodeURIComponent(wabaId)}/subscribed_apps`,{method:"GET"});
        const apps=Array.isArray(result?.data) ? result.data : [];
        // Meta v26 nests app metadata under whatsapp_business_api_data.
        // Keep flat-shape compatibility for older responses.
        const normalizedApps=apps.map((app:any)=>app?.whatsapp_business_api_data ?? app ?? {});
        const configuredAppId=String(Deno.env.get("META_APP_ID") ?? "").trim();
        const configuredApp= configuredAppId
          ? normalizedApps.find((app:any)=>String(app?.id ?? "")===configuredAppId)
          : null;
        const value={
          account_id:account.id,
          business_account_id:wabaId,
          subscriptions:normalizedApps.map((app:any)=>({
            id:app?.id ? String(app.id) : null,
            name:typeof app?.name==="string" ? app.name : null,
            link:typeof app?.link==="string" ? app.link : null,
          })),
          configured_app_id_present:Boolean(configuredAppId),
          configured_app_subscribed:configuredAppId ? Boolean(configuredApp) : null,
          note:configuredAppId
            ? "configured_app_subscribed reports whether this Relay Meta app is subscribed to the WABA."
            : "META_APP_ID is not configured, so the server can list subscribed apps but cannot identify which one is the Relay app."
        };
        return rpc(id,{content:textContent(value),structuredContent:value});
      }

      if(name==="whatsapp_subscribe_waba"){
        const userId=requireWhatsappOAuth(auth);
        const account=await resolveWhatsappAccount(auth,args.account_id);
        const wabaId=String(account.business_account_id ?? "").trim();
        if(!/^\d{3,64}$/.test(wabaId)) throw new Error("This linked number does not have a WABA ID; link it again with business_account_id");
        const result=await whatsappGraph(`${encodeURIComponent(wabaId)}/subscribed_apps`,{
          method:"POST",
          body:JSON.stringify({}),
        });
        if(result?.success!==true && result?.success!=="true") throw new Error("Meta did not confirm the WABA webhook subscription");
        await whatsappAudit(account.id,userId,"waba_subscribed",{business_account_id:wabaId});
        const value={
          subscribed:true,
          account_id:account.id,
          business_account_id:wabaId,
          note:"The Meta app is now subscribed to this WABA. The app-level WhatsApp webhook callback must also be configured and verified in Meta."
        };
        return rpc(id,{content:textContent(value),structuredContent:value});
      }

      if(name==="whatsapp_recent_messages"){
        const account=await resolveWhatsappAccount(auth,args.account_id);
        const limit=Math.max(1,Math.min(100,Number(args.limit ?? 30)));
        const {data,error}=await db.from("project_relay_whatsapp_messages")
          .select("id,wamid,direction,from_number,to_number,message_type,body,status,message_timestamp,created_at,reply_to_wamid")
          .eq("account_id",account.id)
          .order("message_timestamp",{ascending:false,nullsFirst:false})
          .limit(limit);
        if(error) throw error;
        const messages=(data ?? []).map(compactWhatsappMessage);
        return rpc(id,{content:textContent(messages),structuredContent:{messages}});
      }

      if(name==="whatsapp_search_messages"){
        const account=await resolveWhatsappAccount(auth,args.account_id);
        const query=String(args.query ?? "").trim().toLowerCase();
        if(!query) throw new Error("Search query is required");
        const limit=Math.max(1,Math.min(100,Number(args.limit ?? 30)));
        const {data,error}=await db.from("project_relay_whatsapp_messages")
          .select("id,wamid,direction,from_number,to_number,message_type,body,status,message_timestamp,created_at,reply_to_wamid")
          .eq("account_id",account.id)
          .order("message_timestamp",{ascending:false,nullsFirst:false})
          .limit(1000);
        if(error) throw error;
        const messages=(data ?? []).filter((row:any)=>{
          const hay=[row.body,row.from_number,row.to_number,row.message_type,row.direction,row.status]
            .filter((v)=>typeof v==="string").join(" ").toLowerCase();
          return hay.includes(query);
        }).slice(0,limit).map(compactWhatsappMessage);
        return rpc(id,{content:textContent(messages),structuredContent:{messages}});
      }

      if(name==="whatsapp_get_conversation"){
        const account=await resolveWhatsappAccount(auth,args.account_id);
        const contact=normalizeWhatsappNumber(args.contact);
        const limit=Math.max(1,Math.min(200,Number(args.limit ?? 50)));
        const {data,error}=await db.from("project_relay_whatsapp_messages")
          .select("id,wamid,direction,from_number,to_number,message_type,body,status,message_timestamp,created_at,reply_to_wamid")
          .eq("account_id",account.id)
          .order("message_timestamp",{ascending:false,nullsFirst:false})
          .limit(1000);
        if(error) throw error;
        const messages=(data ?? []).filter((row:any)=>{
          const from=String(row.from_number ?? "").replace(/\D/g,"");
          const to=String(row.to_number ?? "").replace(/\D/g,"");
          return from===contact || to===contact;
        }).slice(0,limit).reverse().map(compactWhatsappMessage);
        return rpc(id,{content:textContent(messages),structuredContent:{contact,messages}});
      }

      if(name==="whatsapp_prepare_send"){
        const userId=requireWhatsappOAuth(auth);
        const account=await resolveWhatsappAccount(auth,args.account_id);
        const to=normalizeWhatsappNumber(args.to);
        const body=String(args.body ?? "");
        if(!body.trim()) throw new Error("Message body cannot be empty");
        if(body.length>4096) throw new Error("Message body is too long");
        const replyTo=args.reply_to_wamid ? String(args.reply_to_wamid) : null;
        const expiresAt=new Date(Date.now()+10*60_000).toISOString();
        const {data,error}=await db.from("project_relay_whatsapp_send_requests").insert({
          account_id:account.id,
          user_id:userId,
          to_number:to,
          body,
          reply_to_wamid:replyTo,
          expires_at:expiresAt,
          status:"pending",
        }).select("id,to_number,body,reply_to_wamid,status,expires_at,created_at").single();
        if(error) throw error;
        await whatsappAudit(account.id,userId,"send_prepared",{request_id:data.id,to,body_length:body.length,reply: Boolean(replyTo)});
        const value={
          request_id:data.id,
          to:data.to_number,
          body:data.body,
          reply_to_wamid:data.reply_to_wamid,
          status:data.status,
          expires_at:data.expires_at,
          confirmation_required:true,
          note:"Nothing has been sent. Call whatsapp_send_prepared only after the user confirms this exact recipient and text."
        };
        return rpc(id,{content:textContent(value),structuredContent:value});
      }

      if(name==="whatsapp_send_prepared"){
        const userId=requireWhatsappOAuth(auth);
        const requestId=String(args.request_id ?? "");
        const claimTime=new Date().toISOString();

        // Atomically consume the pending approval before any external request.
        // Exactly one concurrent caller can move pending -> sending.
        const {data:reqRow,error:claimError}=await db.from("project_relay_whatsapp_send_requests")
          .update({status:"sending"})
          .eq("id",requestId)
          .eq("user_id",userId)
          .eq("status","pending")
          .gt("expires_at",claimTime)
          .select("id,account_id,user_id,to_number,body,reply_to_wamid,status,expires_at")
          .maybeSingle();
        if(claimError) throw claimError;

        if(!reqRow){
          const {data:state,error:stateError}=await db.from("project_relay_whatsapp_send_requests")
            .select("id,status,expires_at").eq("id",requestId).eq("user_id",userId).maybeSingle();
          if(stateError) throw stateError;
          if(!state) throw new Error("Prepared WhatsApp message was not found");
          if(state.status==="pending" && new Date(String(state.expires_at)).getTime()<=Date.now()){
            await db.from("project_relay_whatsapp_send_requests")
              .update({status:"expired"}).eq("id",requestId).eq("user_id",userId).eq("status","pending");
            throw new Error("Prepared WhatsApp message has expired; prepare it again");
          }
          throw new Error(`Prepared WhatsApp message is ${state.status}, not available to send`);
        }

        let account:any=null;
        let wamid="";
        try{
          account=await resolveWhatsappAccount(auth,reqRow.account_id);
          const payload:any={
            messaging_product:"whatsapp",
            recipient_type:"individual",
            to:reqRow.to_number,
            type:"text",
            text:{body:reqRow.body},
          };
          if(reqRow.reply_to_wamid) payload.context={message_id:reqRow.reply_to_wamid};

          const sent=await whatsappGraph(`${encodeURIComponent(account.phone_number_id)}/messages`,{
            method:"POST",
            body:JSON.stringify(payload),
          });
          wamid=String(sent?.messages?.[0]?.id ?? "");
          if(!wamid) throw new Error("WhatsApp accepted the request without returning a message ID");
        }catch(error){
          const message=error instanceof Error ? error.message : "WhatsApp send failed";
          await db.from("project_relay_whatsapp_send_requests")
            .update({status:"failed",error:message.slice(0,500)})
            .eq("id",reqRow.id).eq("user_id",userId).eq("status","sending");
          await whatsappAudit(reqRow.account_id,userId,"message_send_failed",{request_id:reqRow.id,to:reqRow.to_number});
          throw error;
        }

        // From this point Meta has returned a WhatsApp message ID, so the external send
        // is authoritative. Local persistence problems must never turn this into a retryable
        // "send failed" result and risk a duplicate message.
        const now=new Date().toISOString();
        let persistenceWarning:string|null=null;

        const {error:updateError}=await db.from("project_relay_whatsapp_send_requests").update({
          status:"sent",sent_wamid:wamid,sent_at:now,error:null,
        }).eq("id",reqRow.id).eq("user_id",userId).eq("status","sending");
        if(updateError){
          console.error("WhatsApp send result persistence failed", updateError.message);
          persistenceWarning="Message was sent by WhatsApp, but the local send-request record could not be finalised.";
        }

        const {error:messageError}=await db.from("project_relay_whatsapp_messages").upsert({
          account_id:account.id,
          wamid,
          direction:"outbound",
          from_number:account.display_phone_number,
          to_number:reqRow.to_number,
          message_type:"text",
          body:reqRow.body,
          reply_to_wamid:reqRow.reply_to_wamid,
          status:"accepted",
          status_timestamp:now,
          message_timestamp:now,
          raw:{source:"project_relay_send"},
          updated_at:now,
        },{onConflict:"account_id,wamid"});
        if(messageError){
          console.error("WhatsApp sent-message persistence failed", messageError.message);
          persistenceWarning=persistenceWarning ?? "Message was sent by WhatsApp, but the local message history could not be updated.";
        }

        await whatsappAudit(account.id,userId,"message_sent",{request_id:reqRow.id,to:reqRow.to_number,wamid,body_length:reqRow.body.length});
        const value={
          sent:true,
          request_id:reqRow.id,
          to:reqRow.to_number,
          wamid,
          status:"accepted",
          ...(persistenceWarning ? {persistence_warning:persistenceWarning} : {}),
        };
        return rpc(id,{content:textContent(value),structuredContent:value});
      }

      if(name==="whatsapp_cancel_prepared"){
        const userId=requireWhatsappOAuth(auth);
        const requestId=String(args.request_id ?? "");
        const {data,error}=await db.from("project_relay_whatsapp_send_requests")
          .update({status:"cancelled"})
          .eq("id",requestId).eq("user_id",userId).eq("status","pending")
          .select("id,account_id,status").maybeSingle();
        if(error) throw error;
        if(!data) throw new Error("No pending prepared WhatsApp message matched that request");
        await whatsappAudit(data.account_id,userId,"send_cancelled",{request_id:data.id});
        const value={request_id:data.id,status:data.status};
        return rpc(id,{content:textContent(value),structuredContent:value});
      }

      if(name==="get_workstation_capabilities"){
        const device=await resolveDevice(args.relay_device,auth);
        const reported=Array.isArray(device.info?.actions) ? device.info.actions : [];
        const advertised=new Set(reported.filter((a:unknown)=>typeof a==="string"));
        const published=tools.filter(t=>PUBLIC_TOOLS.has(t.name) && !["get_profile","get_relay_status","list_workstations","get_workstation_capabilities","whatsapp_status","whatsapp_link_number","whatsapp_subscription_status","whatsapp_subscribe_waba","whatsapp_recent_messages","whatsapp_search_messages","whatsapp_get_conversation","whatsapp_prepare_send","whatsapp_send_prepared","whatsapp_cancel_prepared"].includes(t.name));
        const age=device.last_seen ? Date.now()-new Date(device.last_seen).getTime() : Infinity;
        const value={workstation:device.name,version:device.info?.version ?? null,
          online:age<=90_000,last_seen:device.last_seen,
          owner_full_control:device.info?.owner_full_control === true,
          actions:published.map(t=>({name:t.name,advertised_by_device:advertised.has(t.name),
            owner_required:OWNER_CONTROL_TOOLS.has(t.name)})),
          note:"Heartbeat capabilities are not live validation. This chat may need its connector tool catalog refreshed. Exact approval binding remains enforced; owner remote approval still requires OAuth owner role plus workstation-local Owner Full Control."};
        return rpc(id,{content:textContent(value),structuredContent:value});
      }

      if(name==="list_workstations"){
        let allowedIds: string[] | null = null;
        if(auth.kind === "oauth"){
          const {data:links,error:linkError}=await db.from("project_relay_user_devices")
            .select("device_id").eq("user_id",auth.subject);
          if(linkError) throw linkError;
          allowedIds=(links ?? []).map((row:any)=>String(row.device_id));
        }
        let workstationsQuery=db.from("project_relay_devices")
          .select("id,name,last_seen,enabled,info").eq("enabled",true);
        if(allowedIds) {
          if(allowedIds.length===0) return rpc(id,{content:textContent([]),structuredContent:{workstations:[]}});
          workstationsQuery=workstationsQuery.in("id",allowedIds);
        }
        const {data,error}=await workstationsQuery.order("name");
        if(error) throw error;
        const rows=(data ?? []).map((d)=>{
          const age=d.last_seen ? Date.now()-new Date(d.last_seen).getTime() : null;
          const info=(d.info && typeof d.info==="object") ? d.info : {};
          return {
            name:String(d.name ?? "Project Relay PC"),
            online:age !== null && age <= 90_000,
            version:typeof info.version==="string" ? info.version : undefined,
            platform:typeof info.platform==="string" ? info.platform : undefined,
            owner_full_control:info.owner_full_control === true,
          };
        });
        return rpc(id,{content:textContent(rows),structuredContent:{workstations:rows}});
      }

      // Never accept a magic approval identifier or route around the local gate.
      if(name === "commandport_capture_screen") {
        return rpcError(id,-32603,"Capture disabled: privacy-safe adapter required");
      }
      if(!PUBLIC_TOOLS.has(name)) return rpcError(id,-32602,"Unknown Project Relay tool");
      let out;
      try {
        out=await queueAndWait(name,args,auth);
      } catch (error) {
        // Preserve the request ID and return an MCP tool failure, not an
        // unmatched JSON-RPC error. Never expose arbitrary workstation errors.
        const reason=error instanceof Error ? error.message : "";
        const stage = reason.startsWith("relay_stage:") ? reason.slice("relay_stage:".length) : "";
        const safeErrors: Record<string,string> = {
          "approval has not been granted locally": "Approve this request in the local Project Relay app first.",
          "approval does not match requested action": "The target window or action changed. Return to the intended window and prepare a new approval.",
          "approval expired": "Approval expired. Prepare a new request.",
          "approval already consumed": "This approval was already used. Do not retry the action automatically.",
          "Owner Full Control is not enabled on this workstation": "Owner Full Control is disabled on this workstation. Enable it locally in Project Relay settings, then retry the owner action.",
          "Active window changed; prepare and approve again": "The active window changed. Input stopped; some text may already have been entered. Check locally before retrying.",
          "Project Relay task timed out waiting for workstation response": "No result arrived in time. The action may still run; do not retry automatically.",
        };
        const safeStages: Record<string,string> = {
          "action_not_allowed": "This Relay action is not published by the hosted service.",
          "device_resolution": "The selected Relay workstation is offline, not linked to this account, or not available for the requested owner action.",
          "capability_check": "This workstation's installed Project Relay version does not support that tool yet. Update the workstation first.",
          "task_insert": "Project Relay could not queue the workstation task. Try again later.",
        };
        const message = stage
          ? (safeStages[stage] ?? "Project Relay could not complete the requested workstation action.")
          : (safeErrors[reason] ?? "Project Relay could not complete the request. Check the local app; do not retry input automatically.");
        return rpc(id,{isError:true,content:textContent(message)});
      }

      if(name==="commandport_owner_read_image"){
        const raw=(out.result ?? {}) as Record<string,unknown>;
        const data=typeof raw.base64==="string" ? raw.base64 : "";
        const mime=typeof raw.mime_type==="string" ? raw.mime_type : "";
        if(data && /^image\/(?:jpeg|png|gif|webp)$/i.test(mime)){
          const {base64:_omitted,...metadata}=raw;
          const value={workstation:out.device.name,...metadata};
          return rpc(id,{
            content:[
              {type:"image",data,mimeType:mime},
              {type:"text",text:JSON.stringify(value)},
            ],
            structuredContent:value,
          });
        }
      }
      const value={workstation:out.device.name,...(out.result ?? {})};
      return rpc(id,{content:textContent(value),structuredContent:value});
    }
    return rpcError(id,-32601,"Method not found");
  }catch(e){
    console.error("project-relay-mcp error",e instanceof Error?e.message:String(e));
    return rpcError(null,-32000,"Project Relay request failed");
  }
});
