const DEFAULTS={
  safeguarding:{
    uk:"Thank you for telling us. A member of our team has been alerted. If you or someone else is in immediate danger, please call 999. If you need to talk to someone right now, Samaritans are free to call any time on 116 123. You can return to this chat on this browser for the team's reply.",
    generic:"Thank you for telling us. A member of our team has been alerted. If you or someone else is in immediate danger, please contact your local emergency services now. You can return to this chat on this browser for the team's reply."
  },
  legal:"Thanks for your message. It has been passed to a member of the team. You can return to this chat on this browser for their reply.",
  data_protection:"Thanks — your data request has been passed to a member of the team. You can return to this chat on this browser for their reply.",
  payment_dispute:"Thanks — a member of the team will look into this payment personally. No changes have been made to your payment or account yet. You can return to this chat on this browser for their reply.",
  complaint:"Thanks for letting us know. Your complaint has been passed to a member of the team. You can return to this chat on this browser for their reply."
};

export function holdingCopy(topic,{locale=""}={}){
  if(topic==="safeguarding"){
    return String(locale||"").toLowerCase().startsWith("en-gb")
      ?DEFAULTS.safeguarding.uk
      :DEFAULTS.safeguarding.generic;
  }
  return DEFAULTS[topic]||DEFAULTS.complaint;
}
