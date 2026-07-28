// Pure TypeScript K-Means clustering and TF-IDF for genre-based recommendation

export type Vector = number[];

export interface ClusterResult {
  centroids: Vector[];
  assignments: number[];
}

// Build a vocabulary from all genre tags across all tracks
function buildVocabulary(genreLists: string[][]): string[] {
  const vocab = new Set<string>();
  for (const genres of genreLists) {
    for (const g of genres) vocab.add(g);
  }
  return Array.from(vocab).sort();
}

// TF-IDF: term freq for one doc, IDF across all docs
function tfidf(genreLists: string[][]): { matrix: Vector[]; vocab: string[] } {
  const vocab = buildVocabulary(genreLists);
  const N = genreLists.length;

  // Document frequency per term
  const df = new Array(vocab.length).fill(0);
  for (const genres of genreLists) {
    const docSet = new Set(genres);
    for (let i = 0; i < vocab.length; i++) {
      if (docSet.has(vocab[i])) df[i]++;
    }
  }

  // IDF: log((N + 1) / (df + 1)) + 1 (smoothed)
  const idf = df.map((d) => Math.log((N + 1) / (d + 1)) + 1);

  const matrix = genreLists.map((genres) => {
    const counts = new Array(vocab.length).fill(0);
    for (const g of genres) {
      const idx = vocab.indexOf(g);
      if (idx !== -1) counts[idx]++;
    }
    const total = genres.length || 1;
    // TF * IDF
    return counts.map((c, i) => (c / total) * idf[i]);
  });

  return { matrix, vocab };
}

export function buildTfidf(genreLists: string[][]): { matrix: Vector[]; vocab: string[] } {
  return tfidf(genreLists);
}

// Vectorize a single genre list using a pre-built vocab + IDF
export function vectorize(genres: string[], vocab: string[], idf: Vector): Vector {
  const counts = new Array(vocab.length).fill(0);
  for (const g of genres) {
    const idx = vocab.indexOf(g);
    if (idx !== -1) counts[idx]++;
  }
  const total = genres.length || 1;
  return counts.map((c, i) => (c / total) * idf[i]);
}

export function cosineSimilarity(a: Vector, b: Vector): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function centroid(vectors: Vector[]): Vector {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  return sum.map((s) => s / vectors.length);
}

function assignClusters(vectors: Vector[], centroids: Vector[]): number[] {
  return vectors.map((v) => {
    let bestK = 0;
    let bestSim = -Infinity;
    for (let k = 0; k < centroids.length; k++) {
      const sim = cosineSimilarity(v, centroids[k]);
      if (sim > bestSim) {
        bestSim = sim;
        bestK = k;
      }
    }
    return bestK;
  });
}

export function kMeans(vectors: Vector[], k: number, maxIter = 50): ClusterResult {
  if (vectors.length === 0) return { centroids: [], assignments: [] };
  k = Math.min(k, vectors.length);

  // K-Means++ initialization: spread initial centroids
  const centroids: Vector[] = [vectors[0]];
  while (centroids.length < k) {
    const dists = vectors.map((v) => {
      const sims = centroids.map((c) => cosineSimilarity(v, c));
      const maxSim = Math.max(...sims);
      return 1 - maxSim; // distance = 1 - similarity
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = (dists.reduce((_, __, i) => i, 0) % vectors.length); // deterministic pick
    // Pick the vector with max distance to existing centroids
    let maxDist = -1;
    let pick = 0;
    for (let i = 0; i < dists.length; i++) {
      if (dists[i] > maxDist && !centroids.includes(vectors[i])) {
        maxDist = dists[i];
        pick = i;
      }
    }
    centroids.push(vectors[pick]);
  }

  let assignments = assignClusters(vectors, centroids);

  for (let iter = 0; iter < maxIter; iter++) {
    const newCentroids = Array.from({ length: k }, (_, ki) => {
      const clusterVectors = vectors.filter((_, i) => assignments[i] === ki);
      return clusterVectors.length > 0 ? centroid(clusterVectors) : centroids[ki];
    });

    const newAssignments = assignClusters(vectors, newCentroids);

    // Check convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    for (let ki = 0; ki < k; ki++) centroids[ki] = newCentroids[ki];

    if (!changed) break;
  }

  return { centroids, assignments };
}

// Score a candidate vector against all centroids; return best score
export function scoreAgainstCentroids(vector: Vector, centroids: Vector[]): number {
  if (centroids.length === 0) return 0;
  return Math.max(...centroids.map((c) => cosineSimilarity(vector, c)));
}

// Build IDF array from a pre-computed vocab and a set of genre lists
export function buildIdf(genreLists: string[][], vocab: string[]): Vector {
  const N = genreLists.length;
  return vocab.map((term) => {
    const df = genreLists.filter((g) => g.includes(term)).length;
    return Math.log((N + 1) / (df + 1)) + 1;
  });
}