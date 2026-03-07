import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ReactionItem, type QuotedPostPreview } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useFeedStore } from "../store/feed";
import { usePostCacheStore } from "../store/postCache";
import { useProfileMeStore } from "../store/profileMe";
import PostComposer from "../components/PostComposer";
import { CommentsModal } from "../components/CommentsModal";
import { TopUsers } from "../components/TopUsers";
import { StoriesBar } from "../components/StoriesBar";
import { ReportModal } from "../components/ReportModal";
import { ErrorMessage } from "../components/ErrorMessage";
import { PostSkeleton } from "../components/PostSkeleton";
import { PostMedia } from "../components/PostMedia";
import { PostMusic } from "../components/PostMusic";
import { EditPostModal } from "../components/EditPostModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { ExpandablePostText } from "../components/ExpandablePostText";
import { AuthGateOverlay } from "../components/AuthGateOverlay";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { highlightHashtags } from "../utils/text";
import { extractHashtags } from "../utils/hashtags";
import { getPostContainerColorClass } from "../utils/postColors";
import { MentionPreview } from "../components/MentionPreview";
import { EmojiPicker } from "../components/EmojiPicker";
import { QuotedPostCard } from "../components/QuotedPostCard";
import { useSubscriptionsStore } from "../store/subscriptions";
import { useFollowingFeedStore } from "../store/followingFeed";
import { useUserStatsStore } from "../store/userStats";
import { useAuthGateStore } from "../store/authGate";
import { useI18n } from "../i18n";
import { formatTimeAgo } from "../utils/time";
import type { MediaItem, PostMusic as PostMusicItem } from "../types/media";
import {
  Heart,
  MessageCircle,
  Share2,
  Flag,
  Edit3,
  Trash2,
  Eye,
  Smile,
  MessageSquareQuote,
  Sparkles,
} from "lucide-react";

type FeedItem = {
  id: string;
  user_id: string;
  content: string;
  container_color?: string;
  username: string;
  full_name: string;
  is_verified?: boolean;
  avatar_url?: string;
  created_at: string;
  updated_at?: string;
  media?: MediaItem[];
  music?: PostMusicItem;
  like_count: number;
  liked_by_me: boolean;
  reactions?: ReactionItem[];
  comment_count?: number;
  view_count: number;
  mentions?: string[];
  hashtags?: string[];
  quoted_post?: QuotedPostPreview;
  is_subscribed?: boolean;
  is_me?: boolean;
};

const isHalfVisible = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  const viewH = window.innerHeight || document.documentElement.clientHeight;
  const visibleH = Math.min(rect.bottom, viewH) - Math.max(rect.top, 0);
  return visibleH >= rect.height * 0.5;
};

const normalizeReactions = (input?: ReactionItem[]) => {
  if (!Array.isArray(input) || input.length === 0) return [] as ReactionItem[];
  const cleaned = input
    .filter((item) => item && typeof item.emoji === "string" && item.emoji.trim() !== "")
    .map((item) => ({
      emoji: item.emoji,
      count: Math.max(0, Number(item.count) || 0),
      reacted_by_me: Boolean(item.reacted_by_me),
    }))
    .filter((item) => item.count > 0);
  cleaned.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  return cleaned;
};

const toggleReactionInList = (input: ReactionItem[], emoji: string, shouldReact: boolean) => {
  const current = normalizeReactions(input);
  const next: ReactionItem[] = [];
  let touched = false;
  for (const item of current) {
    if (item.emoji !== emoji) {
      next.push(item);
      continue;
    }
    touched = true;
    const count = item.count + (shouldReact ? 1 : item.reacted_by_me ? -1 : 0);
    if (count > 0) {
      next.push({
        emoji: item.emoji,
        count,
        reacted_by_me: shouldReact,
      });
    }
  }
  if (!touched && shouldReact) {
    next.push({ emoji, count: 1, reacted_by_me: true });
  }
  next.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  return next;
};

export default function FeedPage() {
  const { t, language, pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const token = useAuthStore((s) => s.token);
  const showAuthGate = useAuthGateStore((s) => s.show);
  const {
    items: cachedFeed,
    nextOffset: cachedNext,
    initialized,
    setCache,
    updateItem: updateCacheItem,
    updateByUser: updateCacheByUser,
  } = useFeedStore();
  const {
    items: cachedFollowing,
    nextOffset: cachedFollowingNext,
    initialized: followingInitialized,
    setCache: setFollowingCache,
  } = useFollowingFeedStore();
  const postPatches = usePostCacheStore((s) => s.byId);
  const patchPost = usePostCacheStore((s) => s.patch);
  const setSubsFromPosts = useSubscriptionsStore((s) => s.setManyFromPosts);
  const setFollow = useSubscriptionsStore((s) => s.setFollow);
  const subs = useSubscriptionsStore((s) => s.byUserId);
  const patchCounts = useUserStatsStore((s) => s.patchCounts);
  const subsVersion = useSubscriptionsStore((s) => s.version);
  const [tab, setTab] = useState<"popular" | "following">("popular");
  const [feed, setFeed] = useState<FeedItem[]>(cachedFeed);
  const [popularError, setPopularError] = useState("");
  const [popularLoading, setPopularLoading] = useState(!initialized);
  const [popularNextOffset, setPopularNextOffset] = useState<number | null>(cachedNext);
  const [followingFeed, setFollowingFeed] = useState<FeedItem[]>(cachedFollowing as FeedItem[]);
  const [followingError, setFollowingError] = useState("");
  const [followingLoading, setFollowingLoading] = useState(!followingInitialized);
  const [followingNextOffset, setFollowingNextOffset] = useState<number | null>(cachedFollowingNext);
  const [followingSeenVersion, setFollowingSeenVersion] = useState<number>(subsVersion);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [commentsPost, setCommentsPost] = useState<FeedItem | null>(null);
  const [reportPost, setReportPost] = useState<FeedItem | null>(null);
  const [editPost, setEditPost] = useState<FeedItem | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deletePost, setDeletePost] = useState<FeedItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [quotePost, setQuotePost] = useState<QuotedPostPreview | null>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [postReactionPickerPostId, setPostReactionPickerPostId] = useState<string | null>(null);
  const postReactionPickerAnchorRef = useRef<HTMLButtonElement | null>(null);
  const toastTimer = useRef<number | null>(null);
  const loadViewed = () => {
    try {
      const raw = localStorage.getItem("viewed_posts");
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw);
      return new Set<string>(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set<string>();
    }
  };
  const seenPosts = useRef<Set<string>>(new Set());
  const viewedPersisted = useRef<Set<string>>(loadViewed());
  const pendingTimers = useRef<Map<string, number>>(new Map());
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!token && tab === "following") {
      setTab("popular");
    }
    if (!token) {
      setQuotePost(null);
    }
  }, [token, tab]);

  const toQuotedPost = (item: FeedItem): QuotedPostPreview => ({
    id: item.id,
    user_id: item.user_id,
    username: item.username,
    full_name: item.full_name,
    is_verified: item.is_verified,
    avatar_url: item.avatar_url,
    content: item.content,
    container_color: item.container_color,
    media: item.media,
    created_at: item.created_at,
  });

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const updatePost = (id: string, patch: Partial<FeedItem>) => {
    setFeed((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setFollowingFeed((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    updateCacheItem(id, patch);
    patchPost(id, patch);
    setCommentsPost((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  };

  const updatePostReactions = (id: string, reactions: ReactionItem[]) => {
    const normalized = normalizeReactions(reactions);
    setFeed((prev) => prev.map((p) => (p.id === id ? { ...p, reactions: normalized } : p)));
    setFollowingFeed((prev) => prev.map((p) => (p.id === id ? { ...p, reactions: normalized } : p)));
    updateCacheItem(id, { reactions: normalized });
    setCommentsPost((prev) => (prev?.id === id ? { ...prev, reactions: normalized } : prev));
    patchPost(id, { reactions: normalized });
  };

  const updateAuthor = (userId: string, patch: Partial<FeedItem>) => {
    if (typeof patch.is_subscribed === "boolean") {
      setFollow(userId, patch.is_subscribed);
    }
    setFeed((prev) => prev.map((p) => (p.user_id === userId ? { ...p, ...patch } : p)));
    setFollowingFeed((prev) => prev.map((p) => (p.user_id === userId ? { ...p, ...patch } : p)));
    updateCacheByUser(userId, patch);
  };

  const refreshPopular = async () => {
    setPopularLoading(true);
    try {
      const prevIds = new Set(feed.map((p) => p.id));
      const { items, nextOffset } = await api.feedPage(20, 0, token);
      const newIds = new Set<string>();
      items.forEach((p) => {
        if (!prevIds.has(p.id)) newIds.add(p.id);
      });
      if (newIds.size > 0) {
        setJustAdded(newIds);
        window.setTimeout(() => setJustAdded(new Set()), 700);
      }
      setSubsFromPosts(items as any[]);
      setFeed(items);
      setPopularNextOffset(nextOffset);
      setCache(items, nextOffset);
      setPopularError("");
    } catch (e: any) {
      setPopularError(e.message || t("feed.load_error"));
    } finally {
      setPopularLoading(false);
    }
  };

  const refreshFollowing = async () => {
    if (!token) return;
    setFollowingLoading(true);
    try {
      const { items, nextOffset } = await api.followingFeedPage(20, 0, token);
      setSubsFromPosts(items as any[]);
      setFollowingFeed(items);
      setFollowingNextOffset(nextOffset);
      setFollowingCache(items, nextOffset);
      setFollowingError("");
      setFollowingSeenVersion(subsVersion);
    } catch (e: any) {
      setFollowingError(e.message || t("feed.load_error"));
    } finally {
      setFollowingLoading(false);
    }
  };

  useEffect(() => {
    if (initialized && cachedFeed.length) {
      setFeed(cachedFeed);
      setPopularNextOffset(cachedNext);
      setPopularLoading(false);
      return;
    }
    refreshPopular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (tab !== "following") return;
    if (!token) return;
    if (!followingInitialized || subsVersion !== followingSeenVersion) {
      refreshFollowing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, token, followingInitialized, subsVersion]);

  useEffect(() => {
    if (!token) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const target = entry.target as HTMLElement;
          const id = target.getAttribute("data-post-id");
          if (!id) return;
          if (seenPosts.current.has(id) || viewedPersisted.current.has(id)) {
            obs.unobserve(target);
            return;
          }
          if (!entry.isIntersecting) {
            const pending = pendingTimers.current.get(id);
            if (pending) {
              clearTimeout(pending);
              pendingTimers.current.delete(id);
            }
            return;
          }
          if (pendingTimers.current.has(id)) return;
          const timer = window.setTimeout(() => {
            pendingTimers.current.delete(id);
            if (seenPosts.current.has(id) || viewedPersisted.current.has(id)) return;
            if (!isHalfVisible(target)) return;
            sendView(id);
            seenPosts.current.add(id);
            obs.unobserve(target);
          }, 1000);
          pendingTimers.current.set(id, timer);
        });
      },
      { threshold: 0.5 }
    );
    observer.current = obs;
    return () => {
      obs.disconnect();
      pendingTimers.current.forEach((t) => clearTimeout(t));
      pendingTimers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadMorePopular = async () => {
    if (popularLoading || popularNextOffset === null) return;
    setPopularLoading(true);
    try {
      const { items, nextOffset: n } = await api.feedPage(20, popularNextOffset, token);
      setFeed((prev) => {
        const merged = [...prev, ...items];
        setSubsFromPosts(items as any[]);
        setCache(merged, n);
        return merged;
      });
      setPopularNextOffset(n);
      setPopularError("");
    } catch (e: any) {
      setPopularError(e.message || t("feed.load_error"));
    } finally {
      setPopularLoading(false);
    }
  };

  const loadMoreFollowing = async () => {
    if (followingLoading || !token || followingNextOffset === null) return;
    setFollowingLoading(true);
    try {
      const { items, nextOffset: n } = await api.followingFeedPage(20, followingNextOffset, token);
      setFollowingFeed((prev) => {
        const merged = [...prev, ...items];
        setSubsFromPosts(items as any[]);
        setFollowingCache(merged, n);
        return merged;
      });
      setFollowingNextOffset(n);
      setFollowingError("");
    } catch (e: any) {
      setFollowingError(e.message || t("feed.load_error"));
    } finally {
      setFollowingLoading(false);
    }
  };

  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const activeNextOffset = tab === "popular" ? popularNextOffset : followingNextOffset;
    if (!sentinel || activeNextOffset === null) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (tab === "popular") loadMorePopular();
            else loadMoreFollowing();
          }
        });
      },
      { rootMargin: "200px 0px" }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [tab, popularNextOffset, followingNextOffset, token, popularLoading, followingLoading]);

  const sendView = async (postId: string) => {
    if (!token) return;
    if (viewedPersisted.current.has(postId)) return;
    try {
      await api.viewPost(postId, token);
      const base = feed.find((p) => p.id === postId) || followingFeed.find((p) => p.id === postId);
      const merged = postPatches[postId] ? { ...base, ...postPatches[postId] } : base;
      const nextView = (merged?.view_count ?? 0) + 1;

      patchPost(postId, { view_count: nextView });
      updateCacheItem(postId, { view_count: nextView });
      setFeed((prev) => prev.map((p) => (p.id === postId ? { ...p, view_count: nextView } : p)));
      setFollowingFeed((prev) => prev.map((p) => (p.id === postId ? { ...p, view_count: nextView } : p)));
      setCommentsPost((prev) => (prev?.id === postId ? { ...prev, view_count: nextView } : prev));
      viewedPersisted.current.add(postId);
      try {
        localStorage.setItem("viewed_posts", JSON.stringify(Array.from(viewedPersisted.current)));
      } catch {
        // ignore storage errors
      }
    } catch {
      // ignore view errors silently
    }
  };

  const toggleFollow = async (post: FeedItem, currentIsSubscribed: boolean) => {
    if (!token) {
      showAuthGate({
        title: t("auth.required_title"),
        message: t("feed.auth.subscribe_message"),
        ctaLabel: t("auth.cta_login"),
      });
      return;
    }
    if (post.is_me) return;
    const nextState = !currentIsSubscribed;
    const delta = nextState ? 1 : -1;
    const meId = useProfileMeStore.getState().profile?.id;
    patchCounts(post.user_id, { followers: delta });
    if (meId) patchCounts(meId, { following: delta });
    updateAuthor(post.user_id, { is_subscribed: nextState });
    try {
      if (nextState) {
        await api.followUser(post.user_id, token);
      } else {
        await api.unfollowUser(post.user_id, token);
      }
    } catch {
      patchCounts(post.user_id, { followers: -delta });
      if (meId) patchCounts(meId, { following: -delta });
      updateAuthor(post.user_id, { is_subscribed: currentIsSubscribed });
    }
  };

  const setPostRef = (id: string) => (el: HTMLElement | null) => {
    if (!observer.current || !el) return;
    observer.current.observe(el);
  };

  useEffect(() => {
    const handler = () => setMenuOpenId(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  const setActiveError = (message: string) => {
    if (tab === "popular") setPopularError(message);
    else setFollowingError(message);
  };

  const togglePostReaction = async (postId: string, emoji: string) => {
    if (!token) {
      showAuthGate({
        title: t("auth.required_title"),
        message: t("feed.auth.reaction_message"),
        ctaLabel: t("auth.cta_login"),
      });
      return;
    }
    const currentBase = feed.find((p) => p.id === postId) || followingFeed.find((p) => p.id === postId);
    const currentPatch = postPatches[postId];
    const current = currentPatch ? { ...currentBase, ...currentPatch } : currentBase;
    const previousReactions = normalizeReactions(current?.reactions);
    const hadReaction = previousReactions.some((item) => item.emoji === emoji && item.reacted_by_me);
    const optimistic = toggleReactionInList(previousReactions, emoji, !hadReaction);

    updatePostReactions(postId, optimistic);
    try {
      const result = hadReaction
        ? await api.unreactPost(postId, emoji, token)
        : await api.reactPost(postId, emoji, token);
      updatePostReactions(postId, result.reactions || []);
    } catch (e: any) {
      setActiveError(e.message || tr("Реакция қатесі", "Ошибка реакции", "Reaction error"));
      updatePostReactions(postId, previousReactions);
    }
  };

  const toggleLike = async (id: string, liked: boolean) => {
    if (!token) {
      showAuthGate({
        title: t("auth.required_title"),
        message: t("feed.auth.reaction_message"),
        ctaLabel: t("auth.cta_login"),
      });
      return;
    }
    const currentBase = feed.find((p) => p.id === id) || followingFeed.find((p) => p.id === id);
    const currentPatch = postPatches[id];
    const current = currentPatch ? { ...currentBase, ...currentPatch } : currentBase;
    const currentLikeCount = current?.like_count ?? 0;
    const nextCount = currentLikeCount + (liked ? -1 : 1);
    // optimistic update across both tabs + cache
    setFeed((prev) =>
      prev.map((p) => (p.id === id ? { ...p, liked_by_me: !liked, like_count: nextCount } : p))
    );
    setFollowingFeed((prev) =>
      prev.map((p) => (p.id === id ? { ...p, liked_by_me: !liked, like_count: nextCount } : p))
    );
    updateCacheItem(id, { liked_by_me: !liked, like_count: nextCount });
    setCommentsPost((prev) => (prev?.id === id ? { ...prev, liked_by_me: !liked, like_count: nextCount } : prev));
    patchPost(id, { liked_by_me: !liked, like_count: nextCount });
    try {
      if (liked) await api.unlikePost(id, token);
      else await api.likePost(id, token);
    } catch (e: any) {
      setActiveError(e.message || tr("Лайк қатесі", "Ошибка лайка", "Like error"));
      if (current) {
        setFeed((prev) =>
          prev.map((p) => (p.id === id ? { ...p, liked_by_me: liked, like_count: currentLikeCount } : p))
        );
        setFollowingFeed((prev) =>
          prev.map((p) => (p.id === id ? { ...p, liked_by_me: liked, like_count: currentLikeCount } : p))
        );
        updateCacheItem(id, { liked_by_me: liked, like_count: currentLikeCount });
        setCommentsPost((prev) =>
          prev?.id === id ? { ...prev, liked_by_me: liked, like_count: currentLikeCount } : prev
        );
        patchPost(id, { liked_by_me: liked, like_count: currentLikeCount });
      }
    }
  };

  const sharePost = async (postId: string) => {
    const url = `${window.location.origin}/p/${postId}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t("feed.toast.link_copied"));
      return;
    } catch {
      // Fallback for non-secure contexts / older browsers
    }

    try {
      const el = document.createElement("textarea");
      el.value = url;
      el.setAttribute("readonly", "true");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      showToast(ok ? t("feed.toast.link_copied") : t("feed.toast.link_copy_failed"));
    } catch {
      showToast(t("feed.toast.link_copy_failed"));
    }
  };

  const startQuote = (item: FeedItem) => {
    if (!token) {
      showAuthGate({
        title: t("auth.required_title"),
        message: t("feed.auth.create_post_message"),
        ctaLabel: t("auth.cta_login"),
      });
      return;
    }
    setQuotePost(toQuotedPost(item));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removePostFromLists = (postId: string) => {
    const nextPopular = feed.filter((p) => p.id !== postId);
    const nextFollowing = followingFeed.filter((p) => p.id !== postId);
    setFeed(nextPopular);
    setFollowingFeed(nextFollowing);
    setCache(nextPopular, popularNextOffset);
    setFollowingCache(nextFollowing, followingNextOffset);
    setCommentsPost((prev) => (prev?.id === postId ? null : prev));
    setMenuOpenId((prev) => (prev === postId ? null : prev));
    setPostReactionPickerPostId((prev) => (prev === postId ? null : prev));
  };

  const handleEditSubmit = async (payload: { content: string; media: MediaItem[] }) => {
    if (!token || !editPost) return;
    setEditSaving(true);
    setEditError("");
    try {
      const hashtags = extractHashtags(payload.content);
      const updated = await api.updatePost(
        editPost.id,
        {
          content: payload.content,
          media: payload.media,
          media_url: payload.media[0]?.url || "",
          media_urls: payload.media.map((m) => m.url),
          hashtags,
        },
        token
      );
      updatePost(editPost.id, {
        content: updated.content,
        media: updated.media || [],
        updated_at: updated.updated_at,
        hashtags: updated.hashtags || [],
        mentions: updated.mentions || [],
      });
      patchPost(editPost.id, {
        content: updated.content,
        media: updated.media || [],
        updated_at: updated.updated_at,
        hashtags: updated.hashtags || [],
        mentions: updated.mentions || [],
      });
      setEditPost(null);
    } catch (e: any) {
      setEditError(e?.message || t("feed.load_error"));
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeletePost = async () => {
    if (!token || !deletePost) return;
    setDeleteLoading(true);
    try {
      await api.deletePost(deletePost.id, token);
      removePostFromLists(deletePost.id);
      setDeletePost(null);
    } catch (e: any) {
      setActiveError(e?.message || t("feed.load_error"));
    } finally {
      setDeleteLoading(false);
    }
  };

  const activeError = tab === "popular" ? popularError : followingError;
  const activeLoading = tab === "popular" ? popularLoading : followingLoading;
  const activeNextOffset = tab === "popular" ? popularNextOffset : followingNextOffset;
  const activeItems = tab === "popular" ? feed : followingFeed;
  const visibleItems =
    tab === "following"
      ? activeItems.filter((it) => {
          if (it.is_me) return true;
          const isSub = subs[it.user_id] ?? it.is_subscribed ?? false;
          return isSub;
        })
      : activeItems;

  return (
    <main data-feed-root className="max-w-[672px] w-full mx-auto py-6 space-y-4 page-fade">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-white/60">{t("feed.page_label")}</p>
          <h1 className="text-2xl font-semibold text-white">{t("feed.page_title")}</h1>
        </div>

        <StoriesBar
          token={token}
          leadingAction={
            <Link
              to="/gift/create"
              className="shrink-0 w-[72px] flex flex-col items-center gap-2"
              aria-label={tr("8 Наурыз ашық хаты", "Открытка к 8 марта", "March 8 card")}
              title={tr("8 Наурыз ашық хаты", "Открытка к 8 марта", "March 8 card")}
            >
              <span className="w-14 h-14 rounded-full border border-rose-300/45 bg-rose-500/15 text-rose-100 grid place-items-center">
                <Sparkles className="w-5 h-5" />
              </span>
              <span className="text-[11px] text-white/75 text-center leading-tight max-w-[70px]">
                {tr("8 Наурыз ашық хаты", "Открытка к 8 марта", "March 8 card")}
              </span>
            </Link>
          }
          onRequireAuth={() =>
            showAuthGate({
              title: t("auth.required_title"),
              message: t("feed.auth.create_post_message"),
              ctaLabel: t("auth.cta_login"),
            })
          }
        />

        {token ? (
          <PostComposer
            quotedPost={quotePost}
            onClearQuotedPost={() => setQuotePost(null)}
            onCreated={() => {
              setTab("popular");
              refreshPopular();
            }}
          />
        ) : (
          <AuthGateOverlay
            title={t("auth.required_title")}
            message={t("feed.auth.create_post_message")}
            ctaLabel={t("auth.cta_login")}
            className="overflow-hidden"
          >
            <div className="card p-4 md:p-4 space-y-3 min-h-[210px]">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-white/10 animate-pulse" />
                <div className="h-4 w-52 rounded-full bg-white/10 animate-pulse" />
              </div>
              <div className="h-[92px] rounded-xl border border-white/10 bg-black/40 animate-pulse" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-white/10 animate-pulse" />
                  <div className="h-9 w-9 rounded-full bg-white/10 animate-pulse" />
                  <div className="h-9 w-9 rounded-full bg-white/10 animate-pulse" />
                </div>
                <div className="h-10 w-28 rounded-full bg-white/10 animate-pulse" />
              </div>
            </div>
          </AuthGateOverlay>
        )}

        <div className="flex items-center">
          <div className="rounded-full border border-white/10 bg-black/60 p-1 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab("popular")}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                tab === "popular"
                  ? "bg-white text-black"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              {t("feed.tab_popular")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!token) {
                  showAuthGate({
                    title: t("auth.required_title"),
                    message: t("feed.following_locked_message"),
                    ctaLabel: t("auth.cta_login"),
                  });
                  return;
                }
                setTab("following");
              }}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                tab === "following"
                  ? "bg-white text-black"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              {t("feed.tab_following")}
            </button>
          </div>
        </div>

        <ErrorMessage message={activeError} />

        {activeLoading && visibleItems.length === 0 && !activeError && (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <PostSkeleton key={n} withMedia={n === 1} />
            ))}
          </div>
        )}

        <div className="space-y-3">
          {visibleItems.map((item) => {
            const patch = postPatches[item.id];
            const p = patch ? { ...item, ...patch } : item;
            const postReactions = normalizeReactions(p.reactions);
            const isMe = item.is_me === true;
            const isSub = !isMe && (subs[item.user_id] ?? item.is_subscribed ?? false);
            const postMeta = { ...p, is_subscribed: isSub, is_me: isMe };
            const postColorClass = getPostContainerColorClass(p.container_color);

            return (
            <article
              key={item.id}
              ref={setPostRef(item.id)}
              data-post-id={item.id}
              className={`card p-4 md:p-4 transition hover:border-white/25 relative overflow-hidden ${
              tab === "popular" && justAdded.has(item.id) ? "animate-new-post" : ""
            } ${postColorClass}`}
          >
              <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Link
                  to={`/u/${p.username}`}
                  aria-label={`${tr("Профиль", "Профиль", "Profile")} ${p.full_name || p.username}`}
                  className="relative w-10 h-10 rounded-full bg-white/10 overflow-hidden flex items-center justify-center text-sm font-semibold hover:opacity-90"
                >
                  <span aria-hidden>{p.full_name?.[0]?.toUpperCase() || p.username[0].toUpperCase()}</span>
                  {p.avatar_url ? (
                    <img
                      src={p.avatar_url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                </Link>
                <div>
                  <MentionPreview username={item.username} className="">
                    <Link
                      to={`/u/${item.username}`}
                      className="text-white font-semibold leading-tight flex items-center gap-[3px] hover:underline"
                    >
                      <span>{item.full_name || t("top_users.unnamed")}</span>
                      {item.is_verified ? <VerifiedBadge /> : null}
                    </Link>
                  </MentionPreview>
                  <p className="text-sm text-white/60">{formatTimeAgo(item.created_at, language)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isMe ? (
                  <span className="px-3 py-1 rounded-full border border-white/15 bg-white/5 text-white/70 text-xs">
                    {t("feed.badge_me")}
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFollow(item, isSub);
                    }}
                    className={`px-3 py-1 rounded-full text-xs border transition ${
                      isSub
                        ? "border-white/20 text-white/80 hover:border-white/40"
                        : "border-white text-black bg-white hover:bg-white/90"
                    }`}
                  >
                    {isSub ? t("feed.unfollow") : t("feed.follow")}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === item.id ? null : item.id);
                  }}
                  className="text-white/50 hover:text-white rounded-full p-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  </svg>
                </button>
              </div>

              {menuOpenId === item.id && (
                <div className="absolute right-3 top-10 bg-black/90 border border-white/10 rounded-xl shadow-2xl w-44 z-20 backdrop-blur">
                  {isMe && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        setEditError("");
                        setEditPost(p);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-white/5 text-white"
                    >
                      <Edit3 className="w-4 h-4" strokeWidth={1.7} />
                      {t("feed.menu.edit")}
                    </button>
                  )}
                  {isMe && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        setDeletePost(p);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-white/5 text-red-300"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.7} />
                      {t("feed.menu.delete")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(null);
                      startQuote(item);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-white/5 text-white"
                  >
                    <MessageSquareQuote className="w-4 h-4" strokeWidth={1.7} />
                    {t("feed.menu.quote")}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(null);
                      sharePost(item.id);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-white/5 text-white"
                  >
                    <Share2 className="w-4 h-4" strokeWidth={1.7} />
                    {t("feed.menu.share")}
                  </button>
                  {!isMe && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        if (!token) {
                          showAuthGate({
                            title: t("auth.required_title"),
                            message: t("feed.auth.report_message"),
                            ctaLabel: t("auth.cta_login"),
                          });
                          return;
                        }
                        setReportPost(item);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-white/5 text-red-300"
                    >
                      <Flag className="w-4 h-4" strokeWidth={1.7} />
                      {t("feed.menu.report")}
                    </button>
                  )}
                </div>
              )}
            </div>

            <ExpandablePostText
              text={p.content}
              className="text-white leading-relaxed break-words whitespace-pre-wrap"
              renderText={(text) =>
                highlightHashtags(
                  text,
                  p.mentions ? new Set(p.mentions.map((m) => m.toLowerCase())) : undefined,
                  p.hashtags ? new Set(p.hashtags.map((h) => h.toLowerCase())) : undefined
                )
              }
            />

            {p.quoted_post ? <QuotedPostCard post={p.quoted_post} /> : null}

            <PostMedia media={item.media} autoPlayWhenHalfVisible />
            <PostMusic music={item.music} />
            {postReactions.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {postReactions.map((reaction) => (
                  <button
                    key={`${item.id}-${reaction.emoji}`}
                    type="button"
                    onClick={() => {
                      void togglePostReaction(item.id, reaction.emoji);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                      reaction.reacted_by_me
                        ? "border-amber-300/50 bg-amber-300/20 text-amber-100"
                        : "border-white/15 bg-white/5 text-white/80 hover:border-white/30 hover:text-white"
                    }`}
                    aria-label={`${t("feed.action.reaction")} ${reaction.emoji}`}
                    title={reaction.reacted_by_me ? t("feed.reaction.toggle_off") : t("feed.reaction.toggle_on")}
                  >
                    <span className="text-sm leading-none">{reaction.emoji}</span>
                    <span className="font-medium">{reaction.count}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between text-sm text-white/60">
              <div className="flex items-center gap-6">
                <button
                  onClick={() => toggleLike(item.id, p.liked_by_me)}
                  className={`flex items-center gap-2 px-2 py-1 rounded-full transition ${
                    p.liked_by_me ? "text-red-400" : "text-white/70 hover:text-white"
                  }`}
                >
                  {p.liked_by_me ? (
                    <Heart className="w-5 h-5 fill-current" strokeWidth={1.7} />
                  ) : (
                    <Heart className="w-5 h-5" strokeWidth={1.7} />
                  )}
                  <span className="font-medium">{p.like_count}</span>
                </button>

                <button
                  className="flex items-center gap-2 text-white/60 hover:text-white"
                  onClick={() => {
                    if (!token) {
                      showAuthGate({
                        title: t("auth.required_title"),
                        message: t("feed.auth.comments_message"),
                        ctaLabel: t("auth.cta_login"),
                      });
                      return;
                    }
                    setCommentsPost(postMeta);
                  }}
                >
                  <MessageCircle className="w-5 h-5" strokeWidth={1.7} />
                  <span>{p.comment_count ?? 0}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    postReactionPickerAnchorRef.current = event.currentTarget;
                    setPostReactionPickerPostId((prev) => (prev === item.id ? null : item.id));
                  }}
                  className={`flex items-center gap-2 rounded-full px-2 py-1 transition ${
                    postReactionPickerPostId === item.id
                      ? "text-amber-200 bg-amber-300/15 border border-amber-300/30"
                      : "text-white/60 hover:text-white"
                  }`}
                  aria-label={t("feed.action.add_reaction")}
                  title={t("feed.action.add_reaction")}
                >
                  <Smile className="w-5 h-5" strokeWidth={1.7} />
                  <span className="font-medium">{t("feed.action.reaction")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => startQuote(item)}
                  className="hidden sm:flex items-center gap-2 rounded-full px-2 py-1 text-white/60 hover:text-white transition"
                  aria-label={t("feed.menu.quote")}
                  title={t("feed.menu.quote")}
                >
                  <MessageSquareQuote className="w-5 h-5" strokeWidth={1.7} />
                  <span className="font-medium">{t("feed.action.quote")}</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-white/60">
                <Eye className="w-5 h-5" strokeWidth={1.7} />
                <span>{p.view_count ?? 0}</span>
              </div>
            </div>
          </article>
            );
          })}

          {!activeLoading && visibleItems.length === 0 && !activeError && (
            <div className="card p-6 space-y-2 text-center">
              {tab === "following" ? (
                <>
                  <p className="text-white/80">
                    {t("feed.empty.following_title")}
                  </p>
                  <p className="text-sm text-white/50">
                    {t("feed.empty.following_desc")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-white/80">{t("feed.empty.popular_title")}</p>
                  <p className="text-sm text-white/50">
                    {t("feed.empty.popular_desc")}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        {activeNextOffset !== null && (
          <div ref={loadMoreRef} className="min-h-[1px] flex items-center justify-center text-white/60 text-sm">
            {activeLoading ? t("feed.loading") : t("feed.loading_more")}
          </div>
        )}
        {commentsPost && (
          <CommentsModal
            post={commentsPost}
            onUpdatePost={updatePost}
            onClose={() => setCommentsPost(null)}
          />
        )}
      </div>
      <EmojiPicker
        open={postReactionPickerPostId !== null}
        anchorRef={postReactionPickerAnchorRef}
        onClose={() => setPostReactionPickerPostId(null)}
        onSelect={(emoji) => {
          const targetPostID = postReactionPickerPostId;
          setPostReactionPickerPostId(null);
          if (!targetPostID) return;
          void togglePostReaction(targetPostID, emoji);
        }}
      />
      <EditPostModal
        open={editPost !== null}
        post={editPost}
        loading={editSaving}
        error={editError}
        onClose={() => {
          if (editSaving) return;
          setEditPost(null);
          setEditError("");
        }}
        onSubmit={(payload) => {
          void handleEditSubmit(payload);
        }}
      />
      <ConfirmModal
        open={deletePost !== null}
        title={t("feed.delete.title")}
        description={t("feed.delete.body")}
        confirmLabel={deleteLoading ? t("feed.delete.deleting") : t("feed.delete.confirm")}
        cancelLabel={t("feed.edit.cancel")}
        loading={deleteLoading}
        danger
        onClose={() => {
          if (deleteLoading) return;
          setDeletePost(null);
        }}
        onConfirm={() => {
          void handleDeletePost();
        }}
      />
      <TopUsers />
      {reportPost && (
        <ReportModal
          postId={reportPost.id}
          userId={reportPost.user_id}
          onSuccess={() => showToast(t("feed.toast.report_sent"))}
          onClose={() => setReportPost(null)}
        />
      )}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200]">
          <div className="rounded-full border border-white/10 bg-black/90 backdrop-blur px-4 py-2 text-sm text-white/80 shadow-2xl">
            {toast}
          </div>
        </div>
      )}
    </main>
  );
}
