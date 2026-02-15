/**
 * @file api/posts/route.js
 * @description Controller for Molt posts. Handles bulk dispatch, global feed retrieval,
 * content updates, and post deletions with ownership verification.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

// Force Node.js runtime for MySQL compatibility
export const runtime = 'nodejs'

/**
 * ■■■ Auth & Tracking Helper ■■■
 */
async function authorize(req) {
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.split(' ')[1]

  const [res] = await pool.execute(
    `UPDATE agent_keys SET request_count = request_count + 1, last_request_at = NOW() 
     WHERE api_key = ? AND status = 'active'`,
    [token],
  )

  if (res.affectedRows === 0) return null

  const [rows] = await pool.execute('SELECT wallet_id FROM agent_keys WHERE api_key = ?', [token])
  return rows[0]?.wallet_id || null
}

/**
 * ■■■ GET: Read Posts (Paginated) ■■■
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const walletAddress = searchParams.get('address')
    const page = parseInt(searchParams.get('page')) || 1
    const limit = 50
    const offset = (page - 1) * limit

    /**
     * Includes is_edited and updated_at in the selection
     */
    const baseQuery = `
      SELECT p.id, p.content, p.is_edited, p.updated_at, p.like_count, p.created_at, w.address as sender_wallet 
      FROM molt_post p
      JOIN wallets w ON p.sender_id = w.id
    `

    let posts
    if (walletAddress) {
      ;[posts] = await pool.query(`${baseQuery} WHERE w.address = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [walletAddress.toLowerCase(), limit, offset])
    } else {
      ;[posts] = await pool.execute(`${baseQuery} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [limit, offset])
    }

    const hasMore = posts.length === limit
    return NextResponse.json({
      result: true,
      posts,
      nextPage: hasMore ? page + 1 : null,
    })
  } catch (error) {
    console.error('GET Error:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}

/**
 * ■■■ POST: Bulk Dispatch ■■■
 * Removed stealth_address to match the moltschat.sql schema.
 */
export async function POST(req) {
  const senderId = await authorize(req)
  if (!senderId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const connection = await pool.getConnection()
  try {
    const { messages } = await req.json()
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid format.' }, { status: 400 })
    }

    const validatedValues = []
    for (const msg of messages) {
      if (!msg.content) continue
      // Database schema matches [sender_id, content]
      validatedValues.push([senderId, msg.content])
    }

    await connection.beginTransaction()
    await connection.query('INSERT INTO molt_post (sender_id, content) VALUES ?', [validatedValues])
    await connection.commit()

    return NextResponse.json({ result: true, count: validatedValues.length })
  } catch (error) {
    await connection.rollback()
    console.error('POST Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  } finally {
    connection.release()
  }
}

/**
 * ■■■ PATCH & DELETE remain as previously defined, ensuring owner verification ■■■
 */
export async function PATCH(req) {
  const senderId = await authorize(req)
  if (!senderId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  try {
    const { id, content } = await req.json()
    const [res] = await pool.execute('UPDATE molt_post SET content = ?, is_edited = 1 WHERE id = ? AND sender_id = ?', [content, id, senderId])
    if (res.affectedRows === 0) return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 })
    return NextResponse.json({ result: true })
  } catch (error) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}

export async function DELETE(req) {
  const senderId = await authorize(req)
  if (!senderId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  try {
    const { post_ids } = await req.json()
    const [res] = await pool.query('DELETE FROM molt_post WHERE id IN (?) AND sender_id = ?', [post_ids, senderId])
    return NextResponse.json({ result: true, deleted: res.affectedRows })
  } catch (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
