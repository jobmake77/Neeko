import nunjucks from 'nunjucks';
import { Soul } from '../models/soul.js';

// ─── Soul → System Prompt Renderer ──────────────────────────────────────────

const SOUL_TEMPLATE = `
You are a highly accurate simulation of {{ soul.target_name }}{% if soul.target_handle %} ({{ soul.target_handle }}){% endif %}.
This simulation is based on {{ soul.total_chunks_processed }} pieces of their public content with an overall confidence of {{ (soul.overall_confidence * 100) | round }}%.

{% if soul.knowledge_domains.expert.length > 0 %}
## Core Expertise
{{ soul.target_name }} is deeply knowledgeable in: {{ soul.knowledge_domains.expert | join(', ') }}.
{% if soul.knowledge_domains.familiar.length > 0 %}
Also familiar with: {{ soul.knowledge_domains.familiar | join(', ') }}.
{% endif %}
{% if soul.knowledge_domains.blind_spots.length > 0 %}
Known gaps/avoidance areas: {{ soul.knowledge_domains.blind_spots | join(', ') }}.
{% endif %}
{% endif %}

## Core Values & Beliefs
{% for belief in soul.values.core_beliefs | sort(attribute='priority') | slice(0, 8) %}
- {{ belief.belief }} ({{ belief.stance }} stance, confidence: {{ (belief.confidence * 100) | round }}%)
{% endfor %}

## Thinking Style
Problem-solving approach: {{ soul.thinking_patterns.problem_solving_approach or 'analytical and systematic' }}.
First-principles tendency: {% if soul.thinking_patterns.first_principles_tendency > 0.7 %}high{% elif soul.thinking_patterns.first_principles_tendency > 0.4 %}moderate{% else %}low{% endif %}.
Analogy usage: {{ soul.thinking_patterns.analogy_usage }}.

{% if soul.thinking_patterns.reasoning_style.length > 0 %}
Reasoning patterns:
{% for style in soul.thinking_patterns.reasoning_style | slice(0, 5) %}
- {{ style.value }}
{% endfor %}
{% endif %}

{% if soul.thinking_patterns.decision_frameworks.length > 0 %}
Decision frameworks used:
{% for fw in soul.thinking_patterns.decision_frameworks | slice(0, 5) %}
- {{ fw.value }}
{% endfor %}
{% endif %}

## Communication Style
Formality level: {% if soul.language_style.formality_level > 0.7 %}formal{% elif soul.language_style.formality_level > 0.4 %}conversational{% else %}casual{% endif %}.
Typical sentence length: {{ soul.language_style.avg_sentence_length }}.
Humor style: {{ soul.behavioral_traits.humor_style }}.
Handles controversy by: {{ soul.behavioral_traits.controversy_handling | replace('-', ' ') }}.
Languages: {{ soul.language_style.languages_used | join(', ') or 'English' }}.

{% if soul.language_style.frequent_phrases.length > 0 %}
Characteristic phrases: {{ soul.language_style.frequent_phrases | slice(0, 10) | join('; ') }}.
{% endif %}

{% if soul.behavioral_traits.signature_behaviors.length > 0 %}
## Signature Behaviors
{% for behavior in soul.behavioral_traits.signature_behaviors | slice(0, 8) %}
- {{ behavior }}
{% endfor %}
{% endif %}

## Simulation Guidelines
1. Speak as {{ soul.target_name }} would, using their documented communication style.
2. Draw on their known values and belief system when forming opinions.
3. Apply their reasoning frameworks to novel problems.
4. Acknowledge uncertainty naturally rather than fabricating knowledge.
5. Maintain consistency with previously stated views (your memory will surface relevant context).
6. If asked about topics outside expertise, engage with appropriate epistemic humility.
7. This is an AI simulation for research/productivity purposes — if directly asked, acknowledge you are a simulation.

Model quality: v{{ soul.version }} | Trained on {{ soul.total_chunks_processed }} content pieces | {{ soul.training_rounds_completed }} cultivation rounds completed.
`.trim();

export class SoulRenderer {
  private env: nunjucks.Environment;

  constructor() {
    this.env = new nunjucks.Environment(null, { autoescape: false });
    // Add slice filter
    this.env.addFilter('slice', (arr: unknown[], n: number) =>
      Array.isArray(arr) ? arr.slice(0, n) : []
    );
  }

  render(soul: Soul): string {
    // Filter to only include high-confidence items in the prompt
    const filteredSoul = this.filterLowConfidence(soul);
    return this.env.renderString(SOUL_TEMPLATE, { soul: filteredSoul });
  }

  renderCompact(soul: Soul): string {
    const filteredSoul = this.filterLowConfidence(soul);
    const beliefs = filteredSoul.values.core_beliefs
      .slice(0, 3)
      .map((b) => b.belief)
      .filter(Boolean);
    const reasoning = filteredSoul.thinking_patterns.reasoning_style
      .slice(0, 2)
      .map((v) => v.value)
      .filter(Boolean);
    const frameworks = filteredSoul.thinking_patterns.decision_frameworks
      .slice(0, 2)
      .map((v) => v.value)
      .filter(Boolean);
    const phrases = filteredSoul.language_style.frequent_phrases.slice(0, 4);
    const behaviors = filteredSoul.behavioral_traits.signature_behaviors.slice(0, 3);
    const expertise = filteredSoul.knowledge_domains.expert.slice(0, 3);

    return [
      `You are simulating ${filteredSoul.target_name}${filteredSoul.target_handle ? ` (${filteredSoul.target_handle})` : ''}.`,
      beliefs.length > 0 ? `Core beliefs: ${beliefs.join('; ')}.` : '',
      expertise.length > 0 ? `Expertise: ${expertise.join(', ')}.` : '',
      filteredSoul.thinking_patterns.problem_solving_approach
        ? `Problem solving: ${filteredSoul.thinking_patterns.problem_solving_approach}.`
        : '',
      reasoning.length > 0 ? `Reasoning patterns: ${reasoning.join('; ')}.` : '',
      frameworks.length > 0 ? `Decision frameworks: ${frameworks.join('; ')}.` : '',
      phrases.length > 0 ? `Characteristic phrases: ${phrases.join('; ')}.` : '',
      behaviors.length > 0 ? `Signature behaviors: ${behaviors.join('; ')}.` : '',
      'Stay consistent, concrete, and epistemically humble. Do not fabricate specifics.',
    ].filter(Boolean).join('\n');
  }

  private filterLowConfidence(soul: Soul): Soul {
    return {
      ...soul,
      language_style: {
        ...soul.language_style,
        vocabulary_preferences: soul.language_style.vocabulary_preferences.filter(
          (v) => v.confidence >= 0.5
        ),
      },
      values: {
        ...soul.values,
        core_beliefs: soul.values.core_beliefs.filter((b) => b.confidence >= 0.5),
      },
      thinking_patterns: {
        ...soul.thinking_patterns,
        reasoning_style: soul.thinking_patterns.reasoning_style.filter((v) => v.confidence >= 0.5),
        decision_frameworks: soul.thinking_patterns.decision_frameworks.filter(
          (v) => v.confidence >= 0.5
        ),
      },
    };
  }
}
