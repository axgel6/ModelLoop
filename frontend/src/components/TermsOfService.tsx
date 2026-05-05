interface TermsOfServiceProps {
  onBack: () => void;
}

const LAST_UPDATED = "April 27, 2025";

function TermsOfService({ onBack }: TermsOfServiceProps) {
  return (
    <div className="tos-page">
      <div className="tos-topbar">
        <div className="tos-topbar-left">
          <button className="tos-back-btn" onClick={onBack} title="Back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 12L6 8L10 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <span className="tos-topbar-title">TOS</span>
        <div className="tos-topbar-right" />
      </div>

      <div className="tos-body">
        <div className="tos-container">
          <div className="tos-header-bubble">
            <h1 className="tos-title">Terms of Service</h1>
            <p className="tos-meta">Last updated {LAST_UPDATED}</p>
          </div>

          <div className="tos-intro">
            Please read these Terms carefully before using ModelLoop. By
            accessing or using the service in any way - including as a guest -
            you agree to be bound by these Terms. If you do not agree, do not
            use the service.
          </div>

          <Section num="01" title="Acceptance of Terms">
            <p>
              By creating an account, accessing the service as a guest, or
              otherwise using ModelLoop, you confirm that you have read and
              agree to these Terms. Your continued use of the service after any
              updates constitutes ongoing acceptance.
            </p>
          </Section>

          <Section num="02" title="Eligibility">
            <p>
              You must be at least 13 years of age to use ModelLoop. By using
              the service, you represent that you meet this requirement. If you
              are under 18, you represent that you have parental permission.
            </p>
          </Section>

          <Section num="03" title="Description of Service">
            <p>
              ModelLoop is a personal AI chat application that lets users
              interact with locally-run language models via Ollama. The service
              is provided as-is and may be modified, suspended, or discontinued
              at any time without notice. Guest access is limited and subject to
              rate limits.
            </p>
          </Section>

          <Section num="04" title="User Accounts">
            <p>
              You are responsible for maintaining the confidentiality of your
              account credentials and for all activity under your account.
              Notify us immediately of any unauthorized use. We are not liable
              for losses arising from your failure to protect your credentials.
            </p>
            <p>
              We reserve the right to terminate accounts that violate these
              Terms or that we determine, at our sole discretion, are harmful to
              the service or other users.
            </p>
          </Section>

          <Section num="05" title="Acceptable Use">
            <p>You agree not to use the service to:</p>
            <ul>
              <li>Violate any applicable law or regulation;</li>
              <li>
                Generate or transmit content that is illegal, harmful,
                threatening, abusive, harassing, defamatory, or obscene;
              </li>
              <li>Impersonate any person or entity;</li>
              <li>
                Attempt unauthorized access to any part of the service or its
                systems;
              </li>
              <li>Introduce malware, viruses, or other malicious code;</li>
              <li>
                Scrape or extract data from the service by automated means;
              </li>
              <li>
                Interfere with or disrupt the integrity or performance of the
                service;
              </li>
              <li>
                Use AI-generated outputs to deceive, defraud, or harm any
                person.
              </li>
            </ul>
          </Section>

          <Section num="06" title="AI-Generated Content">
            <p>
              ModelLoop facilitates interaction with AI language models. You
              acknowledge and agree that:
            </p>
            <ul>
              <li>
                AI responses may be inaccurate, incomplete, outdated, or biased;
              </li>
              <li>
                Nothing in the service constitutes legal, medical, financial, or
                any other professional advice;
              </li>
              <li>
                You should independently verify any information before relying
                on it;
              </li>
              <li>
                We are not responsible for decisions made based on AI-generated
                content;
              </li>
              <li>
                The AI may produce unexpected or harmful outputs despite best
                efforts.
              </li>
            </ul>
            <p>
              You assume all risk associated with your use of AI-generated
              content.
            </p>
          </Section>

          <Section num="07" title="Privacy">
            <p>
              We store the minimum data needed to provide the service - your
              email address, hashed password, and chat history. We do not sell
              your data to third parties. Chat history is associated with your
              account and can be deleted by deleting your account.
            </p>
          </Section>

          <Section num="08" title="Disclaimer of Warranties">
            <p className="tos-legal-caps">
              THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS
              WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
              NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT
              THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.
            </p>
          </Section>

          <Section num="09" title="Limitation of Liability">
            <p className="tos-legal-caps">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR
              ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY
              DAMAGES - INCLUDING LOSS OF DATA, PROFITS, OR GOODWILL - ARISING
              FROM YOUR USE OF OR INABILITY TO USE THE SERVICE, EVEN IF ADVISED
              OF THE POSSIBILITY OF SUCH DAMAGES.
            </p>
          </Section>

          <Section num="10" title="Indemnification">
            <p>
              You agree to hold harmless the operator of ModelLoop from any
              claims, damages, or expenses (including reasonable attorney's
              fees) arising from your use of the service, your violation of
              these Terms, or your infringement of any third-party right.
            </p>
          </Section>

          <Section num="11" title="Termination">
            <p>
              We may suspend or terminate your access at any time, with or
              without cause. You may delete your account at any time through
              account settings. Sections covering disclaimers, liability, and
              indemnification survive termination.
            </p>
          </Section>

          <Section num="12" title="Changes to Terms">
            <p>
              We may update these Terms at any time. Changes take effect upon
              posting. Continued use of the service after changes are posted
              constitutes your acceptance. It is your responsibility to check
              these Terms periodically.
            </p>
          </Section>

          <Section num="13" title="Governing Law">
            <p>
              These Terms are governed by the laws of the State of Georgia,
              United States, without regard to conflict of law provisions. Any
              dispute shall be resolved in the courts of Georgia, and you
              consent to personal jurisdiction there.
            </p>
          </Section>

          <Section num="14" title="Severability">
            <p>
              If any provision of these Terms is found invalid or unenforceable,
              it will be limited to the minimum extent necessary, and the
              remaining provisions will remain in effect.
            </p>
          </Section>

          <Section num="15" title="Contact">
            <p>
              For questions about these Terms, please open an issue or
              discussion on the project's GitHub repository.
            </p>
          </Section>

          <div className="tos-footer">
            ModelLoop &middot; Personal Project &middot; {LAST_UPDATED}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tos-section">
      <h2 className="tos-section-title">
        <span className="tos-section-num">{num}</span>
        {title}
      </h2>
      <div className="tos-section-body">{children}</div>
    </section>
  );
}

export default TermsOfService;
