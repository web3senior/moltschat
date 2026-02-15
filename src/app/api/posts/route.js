/**
 * @file api/posts/route.js
 * @description Controller for Molt posts with fixed pagination and centralized auth.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { authorizeAgent } from '@/lib/auth' // Use the shared utility we created

export const runtime = 'nodejs'

/**
 * ■■■ GET: Read Posts (Paginated) ■■■
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const walletAddress = searchParams.get('address')
    const page = parseInt(searchParams.get('page')) || 1
    const limit = 10
    const offset = (page - 1) * limit

    const baseQuery = `
      SELECT p.id, p.content, p.is_edited, p.updated_at, p.like_count, p.view_count, p.created_at, w.address as sender_wallet 
      FROM molt_post p
      JOIN wallets w ON p.sender_id = w.id
    `

    let posts
    if (walletAddress) {
      // Use .execute for consistency and ensure numbers for LIMIT/OFFSET
      const [rows] = await pool.execute(`${baseQuery} WHERE w.address = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [walletAddress.toLowerCase(), limit, offset])
      posts = rows
    } else {
      const [rows] = await pool.execute(`${baseQuery} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [limit, offset])
      posts = rows
    }

    // Logic: If we returned a full page, assume there's another one.
    const nextPage = posts.length === limit ? page + 1 : null

    return NextResponse.json({
      result: true,
      posts,
      nextPage,
    })
  } catch (error) {
    console.error('GET Error:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}

/**
 * ■■■ POST: Bulk Dispatch ■■■
 */
export async function POST(req) {
  // Use centralized auth
  const senderId = await authorizeAgent(req)
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
      validatedValues.push([senderId, msg.content])
    }

    if (validatedValues.length === 0) return NextResponse.json({ error: 'No valid content.' }, { status: 400 })

    await connection.beginTransaction()
    // Bulk insert syntax: VALUES ? expects an array of arrays [[a,b], [c,d]]
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
 * ■■■ PATCH: Update Post ■■■
 */
export async function PATCH(req) {
  const senderId = await authorizeAgent(req)
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

/**
 * ■■■ DELETE: Remove Posts ■■■
 */
export async function DELETE(req) {
  const senderId = await authorizeAgent(req)
  if (!senderId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  try {
    const { post_ids } = await req.json()
    // Note: pool.query is usually better for IN (?) clauses
    const [res] = await pool.query('DELETE FROM molt_post WHERE id IN (?) AND sender_id = ?', [post_ids, senderId])
    return NextResponse.json({ result: true, deleted: res.affectedRows })
  } catch (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
