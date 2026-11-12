import { Link } from "react-router-dom";
import { Page } from "./AppRoutes";

// /about. No personal names on this page.

const link = "text-[var(--ink)] underline underline-offset-2 hover:text-[var(--accent)]";

export function About() {
  return <Page
    titleStyle={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}
    title={<>About{" "}<br /><span className="text-[var(--accent)]">Lensy.</span></>}
    intro="Lensy is built by Perseverance AI. It shows whether AI search engines and coding agents can find, read and cite a documentation page, and what to change if they can't."
  >
    <article className="legal-prose prose-lensy max-w-[760px] py-12 sm:py-16">
      <h2>What Lensy does</h2>
      <p>Paste one documentation page and Lensy reads it the way AI tools do: as an honest bot, without running JavaScript, along with the files those tools look for, such as robots.txt, the sitemap and llms.txt. It gives the page two scores out of 100, one for coding agents and one for AI search, and lists the fixes worth the most points first. <Link to="/docs/checks" className={link}>Every check</Link> in the docs has its points.</p>

      <h2>Where it runs</h2>
      <p>The scanner on this site is free, with a daily limit. The same checks run in the open source <Link to="/docs/cli" className={link}>Lensy command line tool</Link>, on your own machine or in CI, against a live site or a local build. The command line tool sends nothing about your pages to us. Both fetch pages under their own name; the <Link to="/docs/bot" className={link}>Lensy checker page</Link> says what they fetch and how to allow or block them.</p>

      <h2>How we hold ourselves to it</h2>
      <p>The <Link to="/learn/research-behind-ai-ready-docs" className={link}>research article</Link> explains why the checks matter, and <code>lensy explain &lt;id&gt;</code> lists the sources behind each one. We run Lensy on this site too and show the result on the home page, including the low first score from before we rebuilt the site so AI tools could read it. Changes to the checks are listed in the <Link to="/changelog" className={link}>changelog</Link>.</p>

      <h2>Who builds it</h2>
      <p>Lensy is built by Perseverance AI, founded in 2025. Lensy is in beta, and what people tell us decides what we build next, so the Feedback button at the top of every page goes straight to the team.</p>

      <h2>Contact</h2>
      <p>Email <a href="mailto:hello@perseveranceai.com" className={link}>hello@perseveranceai.com</a>, <a href="https://calendly.com/getperseverance" target="_blank" rel="noopener noreferrer" className={link}>book a call</a>, or find us on <a href="https://www.linkedin.com/company/getperseverance/" target="_blank" rel="noopener noreferrer" className={link}>LinkedIn</a> and <a href="https://x.com/getperseverance" target="_blank" rel="noopener noreferrer" className={link}>X</a>. For higher scan limits, <Link to="/contact" className={link}>join the waitlist</Link>.</p>
    </article>
  </Page>;
}
