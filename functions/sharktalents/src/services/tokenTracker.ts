export async function trackTokens(_req: any, jobId: string, action: string, inputTokens: number, outputTokens: number): Promise<void> {
  console.log(`[TOKENS] job=${jobId} action=${action} in=${inputTokens} out=${outputTokens}`);
}
