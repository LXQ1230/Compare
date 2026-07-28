/**
 * Resource estimation utilities for large file warnings.
 */

const MB = 1024 * 1024;

/**
 * Estimate the memory pressure from two files to be compared.
 * Returns a warning message string if the total exceeds 5 MB, otherwise null.
 */
export function estimateMemory(fileA: File, fileB: File): string | null {
  const total = fileA.size + fileB.size;
  if (total > 5 * MB) {
    const rounded = Math.round(total / MB);
    return `文件较大（合计约 ${rounded} MB），对比可能需要较长时间。`;
  }
  return null;
}
