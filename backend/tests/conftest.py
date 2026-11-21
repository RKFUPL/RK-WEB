"""Narrow MongoMock adapter for the marker array filter MongoDB verifies live.

MongoMock has no array-filter support. Unit tests translate this one explicit
operation selector to its numeric path, retaining the application's full
snapshot CAS. All real PyMongo collections bypass this adapter.
"""
from copy import deepcopy
import mongomock
import pytest


@pytest.fixture(autouse=True)
def manual_marker_array_filter_for_mongomock(monkeypatch):
    original = mongomock.collection.Collection.update_one

    def update(collection, query, mutation, *args, **kwargs):
        filters = kwargs.get("array_filters")
        if filters is not None:
            if len(filters) != 1 or set(filters[0]) != {"operation.operationId", "operation.claimToken", "operation.state"}:
                raise NotImplementedError("This unit adapter supports only the manual operation selector.")
            doc = collection.find_one(query)
            if doc:
                indexes = [i for i, row in enumerate(doc.get("inventoryOperationMarkers", []))
                           if all(row.get(k.split(".", 1)[1]) == v for k, v in filters[0].items())]
                if len(indexes) != 1:
                    raise AssertionError("Manual operation selector must match exactly once")
                mutation = deepcopy(mutation)
                mutation["$set"] = {k.replace("$[operation]", str(indexes[0])): v for k, v in mutation["$set"].items()}
            kwargs.pop("array_filters")
        return original(collection, query, mutation, *args, **kwargs)

    monkeypatch.setattr(mongomock.collection.Collection, "update_one", update)
