from project_relay.enrollment import request_pairing_code

result = request_pairing_code()
print("Project Relay pairing code:", result["code"])
print("Workstation:", result["device_name"])
print("Expires:", result["expires_at"])
