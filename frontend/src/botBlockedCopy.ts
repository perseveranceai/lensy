// What a person sees when a site's bot protection refuses the checker (reason
// "blocked-by-bot-protection"). Used by the home page and the results page so
// the wording can't drift between them.
//
// REG-28: never tell the visitor to loosen their bot protection, and never say
// real AI agents are blocked. A block on Lensy (an unverified checker running
// on AWS) says little about verified AI crawlers, which bot protection treats
// differently.

export const BOT_BLOCKED_TITLE = "This site's bot protection blocked our checker";

export function botBlockedDescription(status: string = "403"): string {
  return `HTTP ${status}. That's common for new tools that aren't on Cloudflare's verified-bot list yet, and it doesn't mean verified AI crawlers are blocked. You don't need to change anything. If you'd like Lensy scans to work now, see perseveranceai.com/bot for how to allow Lensy safely.`;
}
