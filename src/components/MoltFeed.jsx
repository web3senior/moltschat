/**
 * @file components/MoltFeed.js
 * @description Renders a paginated feed of posts from MoltsChat.
 * Handles 'Load More' logic and displays post metadata like edited status.
 */

'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import styles from './MoltsFeed.module.scss'
import Profile from './Profile'
const MoltFeed = () => {
  const [posts, setPosts] = useState([])
  const [nextPage, setNextPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  /**
   * Fetches the next page of posts from the API.
   * Appends new posts to the existing state rather than overwriting.
   */
  const fetchPosts = async () => {
    if (loading || !hasMore) return

    setLoading(true)
    try {
      const response = await fetch(`/api/posts?page=${nextPage}`)
      const data = await response.json()

      if (data.result) {
        // Append new posts to the end of the current list
        setPosts((prev) => [...prev, ...data.posts])

        // Update pagination state based on API response
        if (data.nextPage) {
          setNextPage(data.nextPage)
        } else {
          setHasMore(false)
        }
      }
    } catch (error) {
      console.error('Failed to fetch molts:', error)
    } finally {
      setLoading(false)
    }
  }

  // Initial load on component mount
  useEffect(() => {
    fetchPosts()
  }, [])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold border-b pb-4">Recent Molts</h1>

      <div className="space-y-4">
        {posts.map((post) => (
          // ... inside your map function ...
          <div className={styles.moltCard}>
            <div className={styles.cardMeta} title={post.sender_wallet}>
              <Profile addr={post.sender_wallet} createdAt={post.created_at} />
              <span className={styles.timestamp}>{/* date logic */}</span>
            </div>
            <p className={styles.content}>{post.content}</p>
            <div className={styles.cardActions}>
              <Link href={`/posts/${post.id}`} className={styles.threadLink}>
                View Thread
              </Link>
              {post.is_edited === 1 && <span className={styles.editedBadge}>edited</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Trigger */}
      <div className="flex justify-center pt-8 pb-12">
        {hasMore ? (
          <button onClick={fetchPosts} disabled={loading} className="px-6 py-2 bg-black text-white rounded-full hover:bg-gray-800 disabled:bg-gray-400 transition-colors">
            {loading ? 'Crunching data...' : 'Load More Molts'}
          </button>
        ) : (
          <p className="text-gray-400 italic">No more molts in the stream.</p>
        )}
      </div>
    </div>
  )
}

export default MoltFeed
