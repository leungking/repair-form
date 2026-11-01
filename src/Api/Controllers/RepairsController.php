<?php

namespace Hooey\RepairForm\Api\Controllers;

use Flarum\Discussion\Discussion;
use Flarum\Http\RequestUtil;
use Flarum\Tags\Tag;
use Flarum\User\Exception\PermissionDeniedException;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Repair list with permission scoping (the key rule):
 * - property (11) and admins see ALL repair threads;
 * - any other logged-in user sees only their OWN repair threads;
 * - guests are rejected (the frontend never calls this for guests,
 *   it only shows the login prompt, so no 403 banner appears).
 * Status filter and keyword search apply within the visible scope only.
 */
class RepairsController implements RequestHandlerInterface
{
    private const PARENT_TAG_ID = 6;
    private const STATUS_TAG_IDS = [10, 11, 12];

    public static function isHandler($actor): bool
    {
        if ($actor->isAdmin()) {
            return true;
        }

        $groupIds = $actor->groups ? $actor->groups->pluck('id')->all() : [];

        return in_array(11, $groupIds, true);
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $actor = RequestUtil::getActor($request);

        if ($actor->isGuest()) {
            throw new PermissionDeniedException();
        }

        $query = $request->getQueryParams();
        $status = (int) ($query['status'] ?? 0);
        $q = trim((string) ($query['q'] ?? ''));
        $page = max(1, (int) ($query['page'] ?? 1));
        $perPage = min(200, max(1, (int) ($query['per_page'] ?? 50)));

        $privileged = self::isHandler($actor);

        $builder = Discussion::query()
            ->whereHas('tags', function ($t) {
                $t->where('tags.id', self::PARENT_TAG_ID);
            });

        if (! $privileged) {
            $builder->where('discussions.user_id', $actor->id);
        }

        if (in_array($status, self::STATUS_TAG_IDS, true)) {
            $builder->whereHas('tags', function ($t) use ($status) {
                $t->where('tags.id', $status);
            });
        }

        if ($q !== '') {
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q).'%';
            $builder->where('discussions.title', 'like', $like);
        }

        $total = (clone $builder)->count();

        $rows = $builder->with(['user', 'tags'])
            ->orderBy('discussions.last_posted_at', 'desc')
            ->orderBy('discussions.created_at', 'desc')
            ->offset(($page - 1) * $perPage)->limit($perPage)->get();

        $statusNames = Tag::whereIn('id', self::STATUS_TAG_IDS)->get()->keyBy('id');

        $data = [];

        foreach ($rows as $d) {
            $statusId = null;
            $statusLabel = null;

            foreach ($d->tags as $tag) {
                if (in_array($tag->id, self::STATUS_TAG_IDS, true)) {
                    $statusId = $tag->id;
                    $statusLabel = isset($statusNames[$tag->id]) ? $statusNames[$tag->id]->name : null;
                    break;
                }
            }

            $data[] = [
                'id' => $d->id,
                'title' => $d->title,
                'user_id' => $d->user_id,
                'username' => $d->user ? $d->user->username : null,
                'status_tag_id' => $statusId,
                'status_label' => $statusLabel,
                'comment_count' => $d->comment_count,
                'created_at' => $d->created_at ? $d->created_at->toDateTimeString() : null,
                'last_posted_at' => $d->last_posted_at ? $d->last_posted_at->toDateTimeString() : null,
            ];
        }

        $statusOptions = [];

        foreach (self::STATUS_TAG_IDS as $sid) {
            if (isset($statusNames[$sid])) {
                $statusOptions[] = ['id' => $sid, 'name' => $statusNames[$sid]->name];
            }
        }

        return new JsonResponse([
            'data' => $data,
            'meta' => [
                'scope' => $privileged ? 'all' : 'own',
                'status_options' => $statusOptions,
                'total' => $total,
                'page' => $page,
                'per_page' => $perPage,
            ],
        ]);
    }
}
