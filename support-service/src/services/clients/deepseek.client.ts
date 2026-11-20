import config from '../../config';
import { DependencyError } from '../../utils/errors';

/** DeepSeek chat completions (OpenAI-compatible). Only ever sent anonymised text. */
export interface ChatResult { content: string; promptTokens: number; completionTokens: number }

export async function deepseekChat(messages: { role: 'system' | 'user'; content: string }[]): Promise<ChatResult> {
    if (!config.deepseek.apiKey) throw new DependencyError('deepseek');
    let res: Response;
    try {
        res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.deepseek.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: config.deepseek.model, messages, temperature: 0.1, max_tokens: 500, stream: false }),
            signal: AbortSignal.timeout(25000),
        });
    } catch {
        throw new DependencyError('deepseek');
    }
    if (!res.ok) throw new DependencyError('deepseek', res.status);
    const json: any = await res.json().catch(() => null);
    const content = String(json?.choices?.[0]?.message?.content ?? '').trim();
    return {
        content,
        promptTokens: Number(json?.usage?.prompt_tokens ?? 0),
        completionTokens: Number(json?.usage?.completion_tokens ?? 0),
    };
}
