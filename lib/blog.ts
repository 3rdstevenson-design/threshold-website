import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

// File-based blog. Posts are MDX files with frontmatter in content/blog/.
// Read at build time (these helpers only run in Server Components / route
// handlers), so the fs access is fine and the pages prerender to static HTML.
// Frontmatter is parsed cheaply with gray-matter for listings/metadata; the
// MDX body is compiled in the post page via next-mdx-remote.

const POSTS_DIR = path.join(process.cwd(), 'content', 'blog')

export type PostMeta = {
  slug: string
  title: string
  description: string
  date: string // ISO yyyy-mm-dd
  author: string
  avatar: string // which prospect avatar this targets (Marcus/Dana/Frank/Freshman)
  keyword: string // primary target query
  cluster?: string // topic cluster, e.g. "Crossing the Threshold"
  pillar?: boolean // true for the cluster hub post
  heroImage?: string
  ogImage?: string
}

export type Post = PostMeta & { content: string }

function readPostFile(slug: string): Post {
  const fullPath = path.join(POSTS_DIR, `${slug}.mdx`)
  const raw = fs.readFileSync(fullPath, 'utf8')
  const { data, content } = matter(raw)
  return {
    slug,
    title: data.title ?? slug,
    description: data.description ?? '',
    date: data.date ? new Date(data.date).toISOString().slice(0, 10) : '',
    author: data.author ?? 'Dr. Lars Stevenson',
    avatar: data.avatar ?? '',
    keyword: data.keyword ?? '',
    cluster: data.cluster,
    pillar: data.pillar ?? false,
    heroImage: data.heroImage,
    ogImage: data.ogImage,
    content,
  }
}

export function getAllSlugs(): string[] {
  if (!fs.existsSync(POSTS_DIR)) return []
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.mdx') && !f.startsWith('_'))
    .map((f) => f.replace(/\.mdx$/, ''))
}

export function getPostBySlug(slug: string): Post {
  return readPostFile(slug)
}

// Newest first.
export function getAllPosts(): Post[] {
  return getAllSlugs()
    .map(readPostFile)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}
