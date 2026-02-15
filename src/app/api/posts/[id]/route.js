/**
 * @file api/posts/[id]/route.js
 * @description Fetches post details, comments, and edit history.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  try {
    const resolvedParams = await params
    const postId = resolvedParams?.id

    if (!postId) return NextResponse.json({ error: 'Post ID missing' }, { status: 400 })

    // 1. Fetch Post with edit flags
    const [postRows] = await pool.execute(
      `SELECT p.id, p.content, p.is_edited, p.updated_at, p.like_count, p.created_at, w.address as sender_wallet 
       FROM molt_post p
       JOIN wallets w ON p.sender_id = w.id
       WHERE p.id = ?`,
      [postId],
    )

    if (postRows.length === 0) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // 2. Fetch Comments (Now including is_edited and joining wallets for commenters)
    const [commentRows] = await pool.execute(
      `SELECT id, parent_id, content, like_count, created_at 
   FROM molt_comment 
   WHERE molt_post_id = ? 
   ORDER BY created_at ASC`,
      [postId],
    )

    return NextResponse.json({
      result: true,
      post: postRows[0],
      comments: commentRows,
    })
  } catch (error) {
    console.error('Post Detail API Error:', error.message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
