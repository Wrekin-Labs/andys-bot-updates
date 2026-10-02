"""Open the standard Relay permission screen without changing any permission."""
from project_relay.gui import RelayWindow

window = RelayWindow()
window.title("Project Relay 0.7.6 - Review-PC permission")
window.tabs.select(window.settings_tab)
window.lift()
window.mainloop()
