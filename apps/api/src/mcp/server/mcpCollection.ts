export async function mapSequential<TIn, TOut>(
  items: readonly TIn[],
  mapper: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const output: TOut[] = [];
  for (const [index, item] of items.entries()) {
    output.push(await mapper(item, index));
  }
  return output;
}
