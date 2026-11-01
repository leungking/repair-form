<?php

namespace Hooey\RepairForm\Api\Controllers;

use Flarum\Discussion\Discussion;
use Flarum\Http\RequestUtil;
use Flarum\Tags\Event\DiscussionWasTagged;
use Flarum\User\Exception\PermissionDeniedException;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Support\Arr;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * One-click repair status change (property / admin only).
 * The discussion author cannot change status, only follow up by reply.
 *
 * Tag sync goes through the same DiscussionWasTagged event the manual
 * retag UI fires, so tag metadata refreshes and a system "tagged" post
 * records the change in the thread.
 */
class RepairStatusController implements RequestHandlerInterface
{
    private const PARENT_TAG_ID = 6;
    private const STATUS_TAG_IDS = [10, 11, 12];

    public function __construct(protected Dispatcher $events)
    {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $actor = RequestUtil::getActor($request);

        if ($actor->isGuest() || ! RepairsController::isHandler($actor)) {
            throw new PermissionDeniedException();
        }

        $id = (int) Arr::get($request->getAttribute('routeParameters'), 'id');
        $discussion = Discussion::find($id);

        if (! $discussion) {
            return new JsonResponse(['errors' => [['detail' => '维修帖不存在。']]], 404);
        }

        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];
        $newStatus = (int) ($body['status_tag_id'] ?? 0);

        if (! in_array($newStatus, self::STATUS_TAG_IDS, true)) {
            return new JsonResponse(['errors' => [['detail' => '状态无效。']]], 422);
        }

        $currentIds = $discussion->tags->pluck('id')->all();

        if (! in_array(self::PARENT_TAG_ID, $currentIds, true)) {
            return new JsonResponse(['errors' => [['detail' => '该帖不是维修帖。']]], 422);
        }

        $oldTags = $discussion->tags->all();
        $newIds = array_values(array_unique(array_merge(
            array_diff($currentIds, self::STATUS_TAG_IDS),
            [$newStatus]
        )));

        $discussion->tags()->sync($newIds);

        $this->events->dispatch(new DiscussionWasTagged($discussion, $actor, $oldTags));

        return new JsonResponse(['data' => [
            'id' => $discussion->id,
            'status_tag_id' => $newStatus,
        ]]);
    }
}
