import { z } from 'zod';

/**
 * Environment validation.
 *
 * Configuration is read once, at boot, and validated. A missing or malformed
 * value fails the process immediately with a list of what is wrong, rather than
 * surfacing as `undefined` deep inside a request six hours later.
 *
 * This replaces `@nestjs/config`. The package reads `.env` and hands back
 * strings; the validation still has to be written somewhere, and doing it here
 * keeps a single schema that the type system can follow.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // 32 characters is the shortest key that gives a useful HMAC margin.
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('8h'),

    /// Used to build the customer's accept link, which must be absolute.
    PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

    AI_PROVIDER: z.enum(['heuristic', 'llm']).default('heuristic'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),

    /// Comma-separated. Empty means "reflect any origin", which is only safe
    /// because the API authenticates with a bearer token rather than a cookie.
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
  })
  .superRefine((env, ctx) => {
    // Selecting the LLM provider without a key would otherwise fail at the first
    // request instead of at boot.
    if (env.AI_PROVIDER === 'llm' && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when AI_PROVIDER=llm',
      });
    }
    // A production deployment signing tokens with the example secret is worse
    // than one that refuses to start.
    if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'Refusing to start in production with the example JWT_SECRET',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues.map(
    (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

export const ENV = 'ENV_TOKEN';

export function corsOrigins(env: Env): string[] | true {
  const origins = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : true;
}
